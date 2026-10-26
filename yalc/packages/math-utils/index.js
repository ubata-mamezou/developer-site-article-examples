"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.add = add;
exports.subtract = subtract;
exports.multiply = multiply;
exports.divide = divide;
/**
 * 2つの数値を加算する
 * @param a - 第1引数
 * @param b - 第2引数
 * @returns 加算結果
 */
function add(a, b) {
    return a + b;
}
/**
 * 2つの数値を減算する
 * @param a - 第1引数
 * @param b - 第2引数
 * @returns 減算結果
 */
function subtract(a, b) {
    return a - b;
}
/**
 * 2つの数値を乗算する
 * @param a - 第1引数
 * @param b - 第2引数
 * @returns 乗算結果
 */
function multiply(a, b) {
    return a * b;
}
/**
 * 2つの数値を除算する
 * @param a - 第1引数（被除数）
 * @param b - 第2引数（除数）
 * @returns 除算結果
 * @throws ゼロ除算エラー
 */
function divide(a, b) {
    if (b === 0) {
        throw new Error('Division by zero is not allowed');
    }
    return a / b;
}
