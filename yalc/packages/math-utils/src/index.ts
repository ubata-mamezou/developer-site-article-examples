/**
 * 2つの数値を加算する
 * @param a - 第1引数
 * @param b - 第2引数
 * @returns 加算結果
 */
export function add(a: number, b: number): number {
  return a + b;
}

/**
 * 2つの数値を減算する
 * @param a - 第1引数
 * @param b - 第2引数
 * @returns 減算結果
 */
export function subtract(a: number, b: number): number {
  return a - b;
}

/**
 * 2つの数値を乗算する
 * @param a - 第1引数
 * @param b - 第2引数
 * @returns 乗算結果
 */
export function multiply(a: number, b: number): number {
  return a * b;
}

/**
 * 2つの数値を除算する
 * @param a - 第1引数（被除数）
 * @param b - 第2引数（除数）
 * @returns 除算結果
 * @throws ゼロ除算エラー
 */
export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero is not allowed');
  }
  return a / b;
}
