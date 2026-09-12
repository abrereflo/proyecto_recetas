/**
 * Terminal presentation layer.
 *
 * LANGUAGE CONTRACT: every string this module prints is Spanish, because it is
 * what the jury sees projected. Identifiers, comments and file names stay in
 * English.
 *
 * Colour is raw ANSI on purpose: no external dependency, and the demo must not
 * be able to fail because of a formatting library. `NO_COLOR` is honoured
 * (https://no-color.org), and colour is also dropped when stdout is not a TTY,
 * so piped output stays copy-pasteable.
 */

const colorEnabled =
  process.env['NO_COLOR'] === undefined &&
  process.env['TERM'] !== 'dumb' &&
  process.stdout.isTTY === true;

type Style = 'red' | 'green' | 'yellow' | 'cyan' | 'grey' | 'bold' | 'reset';

const CODES: Record<Style, string> = {
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  grey: '\u001b[90m',
  bold: '\u001b[1m',
  reset: '\u001b[0m',
};

function paint(value: string, ...styles: Style[]): string {
  if (!colorEnabled) return value;
  return `${styles.map((style) => CODES[style]).join('')}${value}${CODES.reset}`;
}

export const red = (value: string): string => paint(value, 'red');
export const boldRed = (value: string): string => paint(value, 'bold', 'red');
export const green = (value: string): string => paint(value, 'green');
export const boldGreen = (value: string): string => paint(value, 'bold', 'green');
export const yellow = (value: string): string => paint(value, 'yellow');
export const cyan = (value: string): string => paint(value, 'cyan');
export const grey = (value: string): string => paint(value, 'grey');
export const bold = (value: string): string => paint(value, 'bold');

export function line(value = ''): void {
  process.stdout.write(`${value}\n`);
}

/** Section header for a phase of the flow. */
export function heading(title: string): void {
  line();
  line(bold(title));
  line(grey('─'.repeat(Math.max(title.length, 44))));
}

/** A numbered check inside a sequence, as required by screen P3 of docs/17. */
export function step(index: number, total: number, text: string): void {
  line(`${grey(`[${index}/${total}]`)} ${text}`);
}

export function ok(text: string): void {
  line(`  ${green('OK')}  ${text}`);
}

export function fail(text: string): void {
  line(`  ${red('NO')}  ${text}`);
}

export function info(label: string, value: string): void {
  line(`  ${grey(`${label}:`)} ${value}`);
}

export function note(text: string): void {
  line(`  ${grey(text)}`);
}

const BOX_WIDTH = 44;

function boxRow(text: string): string {
  const trimmed = text.length > BOX_WIDTH ? text.slice(0, BOX_WIDTH) : text;
  const free = BOX_WIDTH - trimmed.length;
  const left = Math.floor(free / 2);
  return `║${' '.repeat(left)}${trimmed}${' '.repeat(free - left)}║`;
}

/**
 * The verdict block. Screen P6 of docs/17 sizes this headline to be read from
 * three metres away; in a terminal that means a box that cannot be skimmed past.
 */
export function verdictBox(title: string, tone: 'reject' | 'accept'): void {
  const colorize = tone === 'reject' ? boldRed : boldGreen;
  line();
  line(colorize(`╔${'═'.repeat(BOX_WIDTH)}╗`));
  line(colorize(boxRow(title)));
  line(colorize(`╚${'═'.repeat(BOX_WIDTH)}╝`));
}

export function pause(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
