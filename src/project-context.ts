/** Quote one value for POSIX shells without allowing interpolation. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function projectUnlockCommand(directory = process.cwd()): string {
  return `cd ${shellQuote(directory)}\nnpx -y github:zwowo1997/gcp-x402 unlock`;
}

export function lockedServiceHelp(directory = process.cwd()): string {
  return `Private beta session missing for this project directory. Run exactly:\n${projectUnlockCommand(directory)}`;
}
