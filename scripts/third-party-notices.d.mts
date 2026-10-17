export interface PackageNotice {
  name: string;
  version: string;
  license: string;
  texts: string[];
}
export function packageRoot(file: string): string | null;
export function readPackage(folder: string): PackageNotice | null;
export function formatNotices(packages: Array<PackageNotice | null>, intro?: string): string;
export function dependencyRoots(folder: string): string[];
