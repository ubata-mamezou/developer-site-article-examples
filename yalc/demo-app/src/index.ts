import { add, subtract, multiply, divide } from '@local/math-utils';

console.log('=== Math Utils Demo ===\n');

// 加算のデモ
const num1 = 10;
const num2 = 5;
console.log(`${num1} + ${num2} = ${add(num1, num2)}`);

// 減算のデモ
console.log(`${num1} - ${num2} = ${subtract(num1, num2)}`);

// 乗算のデモ
console.log(`${num1} × ${num2} = ${multiply(num1, num2)}`);

// 除算のデモ
console.log(`${num1} ÷ ${num2} = ${divide(num1, num2)}`);

// エラーハンドリングのデモ
console.log('\n--- Error Handling Demo ---');
try {
  console.log(`${num1} ÷ 0 = ${divide(num1, 0)}`);
} catch (error) {
  console.error('エラー:', error instanceof Error ? error.message : error);
}

console.log('\n✓ Demo completed successfully!');
