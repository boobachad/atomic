import { invoke } from '@tauri-apps/api/core';

// Re-export invoke for convenience
export { invoke };

// Type-safe wrapper for checking sqlite-vec
export async function checkSqliteVec(): Promise<string> {
  return invoke<string>('check_sqlite_vec');
}

