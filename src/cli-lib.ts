import { readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import chalk from "chalk";
import {
  format,
  get,
  getComment,
  getTrailingComment,
  merge,
  modify,
  move,
  parse,
  parsePath,
  remove,
  removeComment,
  removeTrailingComment,
  rename,
  set,
  setComment,
  setTrailingComment,
  sort
} from "./index.js";

// Re-export parsePath for backward compatibility with tests
export { parsePath };

// =============================================================================
// Security Functions
// =============================================================================

/**
 * Default limits for security
 */
const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const DEFAULT_MAX_JSON_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_JSON_DEPTH = 100;

/**
 * Get JSON parsing limits from environment variables
 */
function getJsonLimits(): {
  maxSize: number;
  maxDepth: number;
} {
  const maxSize =
    process.env.AYWSON_MAX_JSON_SIZE !== undefined
      ? Number.parseInt(process.env.AYWSON_MAX_JSON_SIZE, 10)
      : DEFAULT_MAX_JSON_SIZE;

  const maxDepth =
    process.env.AYWSON_MAX_JSON_DEPTH !== undefined
      ? Number.parseInt(process.env.AYWSON_MAX_JSON_DEPTH, 10)
      : DEFAULT_MAX_JSON_DEPTH;

  if (Number.isNaN(maxSize) || maxSize < 0) {
    throw new Error(
      "Invalid AYWSON_MAX_JSON_SIZE environment variable (must be non-negative integer)"
    );
  }

  if (Number.isNaN(maxDepth) || maxDepth < 0) {
    throw new Error(
      "Invalid AYWSON_MAX_JSON_DEPTH environment variable (must be non-negative integer)"
    );
  }

  return { maxSize, maxDepth };
}

/**
 * Calculate the depth of a JSON value
 */
function calculateJsonDepth(value: unknown, currentDepth = 0): number {
  if (currentDepth > 1000) {
    // Safety limit to prevent infinite recursion
    return currentDepth;
  }

  if (value === null || typeof value !== "object") {
    return currentDepth;
  }

  if (Array.isArray(value)) {
    return Math.max(
      currentDepth,
      ...value.map((item) => calculateJsonDepth(item, currentDepth + 1))
    );
  }

  // Object
  return Math.max(
    currentDepth,
    ...Object.values(value).map((val) =>
      calculateJsonDepth(val, currentDepth + 1)
    )
  );
}

/**
 * Safely parse JSON with size and depth limits
 */
function safeJsonParse(
  str: string,
  maxSize?: number,
  maxDepth?: number
): unknown {
  const limits = getJsonLimits();
  const sizeLimit = maxSize ?? limits.maxSize;
  const depthLimit = maxDepth ?? limits.maxDepth;

  // Check size
  if (str.length > sizeLimit) {
    throw new Error(
      `JSON input too large: ${str.length} bytes (max: ${sizeLimit} bytes). ` +
        `Override with AYWSON_MAX_JSON_SIZE environment variable.`
    );
  }

  // Parse JSON
  const parsed = JSON.parse(str);

  // Check depth
  const depth = calculateJsonDepth(parsed);
  if (depth > depthLimit) {
    throw new Error(
      `JSON input too deeply nested: ${depth} levels (max: ${depthLimit} levels). ` +
        `Override with AYWSON_MAX_JSON_DEPTH environment variable.`
    );
  }

  return parsed;
}

/**
 * Validate file path to prevent path traversal attacks
 */
function validatePath(filePath: string, allowPathTraversal: boolean): string {
  if (allowPathTraversal || filePath === "-") {
    return filePath;
  }

  // Resolve the path relative to current working directory
  const resolved = resolve(process.cwd(), filePath);
  const base = resolve(process.cwd());

  // Check if resolved path is outside the base directory
  const relativePath = relative(base, resolved);
  if (
    relativePath.startsWith("..") ||
    relativePath.includes("..") ||
    (process.platform === "win32" &&
      resolved !== base &&
      !resolved.startsWith(base))
  ) {
    throw new Error(
      `Path traversal detected: "${filePath}". ` +
        `Use --allow-path-traversal to override (not recommended).`
    );
  }

  return resolved;
}

// =============================================================================
// Diff Display
// =============================================================================

/**
 * Generate a simple line-by-line diff between two strings
 */
export function diff(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  // Simple LCS-based diff
  const result: string[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const oldLine = oldLines[oldIdx];
    const newLine = newLines[newIdx];

    if (oldLine === undefined) {
      // Only new lines left
      result.push(chalk.green(`+ ${newLine}`));
      newIdx++;
    } else if (newLine === undefined) {
      // Only old lines left
      result.push(chalk.red(`- ${oldLine}`));
      oldIdx++;
    } else if (oldLine === newLine) {
      // Lines match
      result.push(chalk.gray(`  ${oldLine}`));
      oldIdx++;
      newIdx++;
    } else {
      // Lines differ - look ahead to find matches
      const oldInNew = newLines.indexOf(oldLine, newIdx);
      const newInOld = oldLines.indexOf(newLine, oldIdx);

      if (oldInNew === -1 && newInOld === -1) {
        // Neither line appears later, show as change
        result.push(chalk.red(`- ${oldLine}`));
        result.push(chalk.green(`+ ${newLine}`));
        oldIdx++;
        newIdx++;
      } else if (oldInNew === -1 || (newInOld !== -1 && newInOld < oldInNew)) {
        // Old line appears in new, so new line was added
        result.push(chalk.red(`- ${oldLine}`));
        oldIdx++;
      } else {
        // New line appears in old, so old line was removed
        result.push(chalk.green(`+ ${newLine}`));
        newIdx++;
      }
    }
  }

  return result.join("\n");
}

// =============================================================================
// CLI
// =============================================================================

function printHelp(): void {
  console.log(`
aywson - Modify JSONC while preserving comments and formatting

Usage:
  aywson <command> [options] <file> [args...]

Commands:
  parse <file>                        Parse JSONC and output as JSON
  get <file> <path>                   Get value at path
  set <file> <path> <value>           Set value at path
  remove <file> <path>                Remove field at path
  modify <file> <json>                Replace semantics (delete unmentioned fields)
  merge <file> <json>                 Merge without deleting
  rename <file> <path> <newKey>       Rename a key
  move <file> <fromPath> <toPath>     Move field to new location
  sort <file> [path]                  Sort object keys alphabetically
  format <file>                       Format/prettify JSONC
  comment <file> <path> [text]        Get or set comment for a field
  uncomment <file> <path>             Remove comment from a field

Options:
  --dry-run, -n              Show diff but don't write to file
  --no-deep                  For sort: only sort specified object, not nested
  --tab-size <n>             For format: spaces per indent (default: 2)
  --tabs                     For format: use tabs instead of spaces
  --trailing                 For comment/uncomment: use trailing comment (same line)
  --allow-path-traversal     Allow file paths outside current directory (not recommended)
  --max-file-size <bytes>    Maximum file size in bytes (default: 50MB)
  --no-file-size-limit       Disable file size limit (not recommended)
  --help, -h                 Show this help
  --version, -v              Show version

Security:
  JSON parsing limits can be overridden via environment variables:
    AYWSON_MAX_JSON_SIZE  Maximum JSON input size in bytes (default: 10MB)
    AYWSON_MAX_JSON_DEPTH Maximum JSON nesting depth (default: 100)

Path Syntax:
  Use dot-notation: config.database.host
  Array indices: items.0 or items[0]

Examples:
  aywson parse config.jsonc
  aywson get config.json database.host
  aywson set config.json database.port 5433
  aywson set --dry-run config.json database.port 5433
  aywson modify config.json '{"database": {"host": "prod.db.com"}}'
  aywson sort config.json
  aywson sort config.json dependencies --no-deep
  aywson format config.json
  aywson format config.json --tab-size 4
  aywson format config.json --tabs
  aywson comment config.json database.host "primary host"
  aywson comment --trailing config.json database.port "default: 5432"
`);
}

function printVersion(): void {
  // Read version from package.json
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8")
    );
    console.log(pkg.version);
  } catch {
    console.log("unknown");
  }
}

interface ParsedArgs {
  command: string;
  file: string;
  args: string[];
  dryRun: boolean;
  noDeep: boolean;
  tabSize: number;
  useTabs: boolean;
  trailing: boolean;
  allowPathTraversal: boolean;
  maxFileSize: number | null;
  noFileSizeLimit: boolean;
}

function parseArgs(argv: string[]): ParsedArgs | null {
  const args = argv.slice(2); // Skip node and script path

  // Check for help/version flags
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return null;
  }

  if (args.includes("--version") || args.includes("-v")) {
    printVersion();
    return null;
  }

  // Parse flags
  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const noDeep = args.includes("--no-deep");
  const useTabs = args.includes("--tabs");
  const trailing = args.includes("--trailing");
  const allowPathTraversal = args.includes("--allow-path-traversal");
  const noFileSizeLimit = args.includes("--no-file-size-limit");

  // Parse --tab-size <n>
  let tabSize = 2;
  const tabSizeIdx = args.indexOf("--tab-size");
  const tabSizeValue = tabSizeIdx !== -1 ? args[tabSizeIdx + 1] : undefined;
  if (tabSizeValue) {
    tabSize = Number.parseInt(tabSizeValue, 10);
    if (Number.isNaN(tabSize) || tabSize < 0) {
      console.error("Error: --tab-size must be a non-negative integer");
      process.exit(1);
    }
  }

  // Parse --max-file-size <bytes>
  let maxFileSize: number | null = null;
  const maxFileSizeIdx = args.indexOf("--max-file-size");
  const maxFileSizeValue =
    maxFileSizeIdx !== -1 ? args[maxFileSizeIdx + 1] : undefined;
  if (maxFileSizeValue) {
    maxFileSize = Number.parseInt(maxFileSizeValue, 10);
    if (Number.isNaN(maxFileSize) || maxFileSize < 0) {
      console.error("Error: --max-file-size must be a non-negative integer");
      process.exit(1);
    }
  }

  // Filter out flags and their values
  const positional = args.filter((a, i) => {
    if (a.startsWith("-") && a !== "-") return false;
    // Skip values after flags
    if (i > 0 && args[i - 1] === "--tab-size") return false;
    if (i > 0 && args[i - 1] === "--max-file-size") return false;
    return true;
  });

  const command = positional[0];
  const file = positional[1];

  if (!command || !file) {
    console.error("Error: Missing command or file argument");
    console.error("Run 'aywson --help' for usage");
    process.exit(1);
  }

  return {
    command,
    file,
    args: positional.slice(2),
    dryRun,
    noDeep,
    tabSize,
    useTabs,
    trailing,
    allowPathTraversal,
    maxFileSize,
    noFileSizeLimit
  };
}

function readInput(
  file: string,
  allowPathTraversal: boolean,
  maxFileSize: number | null,
  noFileSizeLimit: boolean
): string {
  // Validate path (unless stdin or override is set)
  const validatedFile = validatePath(file, allowPathTraversal);

  if (validatedFile === "-") {
    // Read from stdin (no size limit for stdin)
    return readFileSync(0, "utf-8");
  }

  // Check file size if limit is enabled
  if (!noFileSizeLimit) {
    const sizeLimit = maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    try {
      const stats = statSync(validatedFile);
      if (stats.size > sizeLimit) {
        throw new Error(
          `File too large: ${stats.size} bytes (max: ${sizeLimit} bytes). ` +
            `Use --max-file-size <bytes> or --no-file-size-limit to override.`
        );
      }
    } catch (error) {
      // If stat fails (e.g., file doesn't exist), let readFileSync handle it
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  return readFileSync(validatedFile, "utf-8");
}

function writeOutput(
  file: string,
  content: string,
  allowPathTraversal: boolean
): void {
  if (file === "-") {
    process.stdout.write(content);
  } else {
    // Validate path (unless override is set)
    const validatedFile = validatePath(file, allowPathTraversal);
    writeFileSync(validatedFile, content);
  }
}

export function run(): void {
  const parsed = parseArgs(process.argv);
  if (!parsed) return;

  const {
    command,
    file,
    args,
    dryRun,
    noDeep,
    tabSize,
    useTabs,
    trailing,
    allowPathTraversal,
    maxFileSize,
    noFileSizeLimit
  } = parsed;

  try {
    const json = readInput(
      file,
      allowPathTraversal,
      maxFileSize,
      noFileSizeLimit
    );

    switch (command) {
      case "parse": {
        const value = parse(json);
        console.log(JSON.stringify(value, null, 2));
        break;
      }

      case "get": {
        const pathArg = args[0];
        if (!pathArg) {
          console.error("Error: get requires a path argument");
          process.exit(1);
        }
        const path = parsePath(pathArg);
        const value = get(json, path);
        console.log(JSON.stringify(value, null, 2));
        break;
      }

      case "set": {
        const pathArg = args[0];
        const valueArg = args[1];
        if (!pathArg || !valueArg) {
          console.error("Error: set requires path and value arguments");
          process.exit(1);
        }
        const path = parsePath(pathArg);
        const value = safeJsonParse(valueArg);
        const result = set(json, path, value);
        handleMutation(file, json, result, dryRun, allowPathTraversal);
        break;
      }

      case "remove": {
        const pathArg = args[0];
        if (!pathArg) {
          console.error("Error: remove requires a path argument");
          process.exit(1);
        }
        const path = parsePath(pathArg);
        const result = remove(json, path);
        handleMutation(file, json, result, dryRun, allowPathTraversal);
        break;
      }

      case "modify": {
        const changesArg = args[0];
        if (!changesArg) {
          console.error("Error: modify requires a JSON argument");
          process.exit(1);
        }
        const changes = safeJsonParse(changesArg);
        if (
          typeof changes !== "object" ||
          changes === null ||
          Array.isArray(changes)
        ) {
          console.error("Error: modify requires a JSON object");
          process.exit(1);
        }
        const result = modify(json, changes as Record<string, unknown>);
        handleMutation(file, json, result, dryRun, allowPathTraversal);
        break;
      }

      case "merge": {
        const changesArg = args[0];
        if (!changesArg) {
          console.error("Error: merge requires a JSON argument");
          process.exit(1);
        }
        const changes = safeJsonParse(changesArg);
        if (
          typeof changes !== "object" ||
          changes === null ||
          Array.isArray(changes)
        ) {
          console.error("Error: merge requires a JSON object");
          process.exit(1);
        }
        const result = merge(json, changes as Record<string, unknown>);
        handleMutation(file, json, result, dryRun, allowPathTraversal);
        break;
      }

      case "rename": {
        const pathArg = args[0];
        const newKeyArg = args[1];
        if (!pathArg || !newKeyArg) {
          console.error("Error: rename requires path and newKey arguments");
          process.exit(1);
        }
        const path = parsePath(pathArg);
        const result = rename(json, path, newKeyArg);
        handleMutation(file, json, result, dryRun, allowPathTraversal);
        break;
      }

      case "move": {
        const fromArg = args[0];
        const toArg = args[1];
        if (!fromArg || !toArg) {
          console.error("Error: move requires fromPath and toPath arguments");
          process.exit(1);
        }
        const fromPath = parsePath(fromArg);
        const toPath = parsePath(toArg);
        const result = move(json, fromPath, toPath);
        handleMutation(file, json, result, dryRun, allowPathTraversal);
        break;
      }

      case "sort": {
        const pathArg = args[0];
        const path = pathArg ? parsePath(pathArg) : [];
        const result = sort(json, path, { deep: !noDeep });
        handleMutation(file, json, result, dryRun, allowPathTraversal);
        break;
      }

      case "format": {
        const result = format(json, {
          tabSize,
          insertSpaces: !useTabs
        });
        handleMutation(file, json, result, dryRun, allowPathTraversal);
        break;
      }

      case "comment": {
        const pathArg = args[0];
        const textArg = args[1];
        if (!pathArg) {
          console.error("Error: comment requires a path argument");
          process.exit(1);
        }
        const path = parsePath(pathArg);
        if (textArg === undefined) {
          // Get comment
          const comment = trailing
            ? getTrailingComment(json, path)
            : getComment(json, path);
          if (comment === null) {
            console.log("(no comment)");
          } else {
            console.log(comment);
          }
        } else {
          // Set comment
          const result = trailing
            ? setTrailingComment(json, path, textArg)
            : setComment(json, path, textArg);
          handleMutation(file, json, result, dryRun, allowPathTraversal);
        }
        break;
      }

      case "uncomment": {
        const pathArg = args[0];
        if (!pathArg) {
          console.error("Error: uncomment requires a path argument");
          process.exit(1);
        }
        const path = parsePath(pathArg);
        const result = trailing
          ? removeTrailingComment(json, path)
          : removeComment(json, path);
        handleMutation(file, json, result, dryRun, allowPathTraversal);
        break;
      }

      default:
        console.error(`Error: Unknown command '${command}'`);
        console.error("Run 'aywson --help' for usage");
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("An unknown error occurred");
    }
    process.exit(1);
  }
}

function handleMutation(
  file: string,
  original: string,
  result: string,
  dryRun: boolean,
  allowPathTraversal: boolean
): void {
  // Always show the diff
  if (original !== result) {
    console.log(diff(original, result));
  } else {
    console.log("No changes");
  }

  // Write unless dry-run
  if (!dryRun && file !== "-") {
    writeOutput(file, result, allowPathTraversal);
  } else if (dryRun) {
    console.log("\n(dry-run: file not modified)");
  }
}
