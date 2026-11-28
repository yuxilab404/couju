/** 解 (XᵀX + λI)w = Xᵀy，输入为增广矩阵；就地消元。 */
export function solveRidge(matrix: number[][], penalty: number): number[] {
  const d = matrix.length;
  if (!d) throw new Error('没有可训练的决策');
  for (let i = 0; i < d; i++) matrix[i][i] += penalty;
  for (let i = 0; i < d; i++) {
    const pivot = matrix[i][i];
    for (let j = i; j <= d; j++) matrix[i][j] /= pivot;
    for (let k = 0; k < d; k++) {
      if (k === i) continue;
      const factor = matrix[k][i];
      for (let j = i; j <= d; j++) matrix[k][j] -= factor * matrix[i][j];
    }
  }
  return matrix.map(row => Number(row[d].toFixed(4)));
}
