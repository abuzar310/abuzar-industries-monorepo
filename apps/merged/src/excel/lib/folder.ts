export const DEFAULT_FOLDER_ID = "my-sheets";

export function folderOf(id?: string | null): string {
  return id && id.trim() ? id : DEFAULT_FOLDER_ID;
}
