export function packageLockFor(packageManifest) {
  const rootPackage = {
    name: packageManifest.name,
    version: packageManifest.version
  };
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (packageManifest[field] && Object.keys(packageManifest[field]).length) rootPackage[field] = packageManifest[field];
  }
  return {
    name: packageManifest.name,
    version: packageManifest.version,
    lockfileVersion: 3,
    requires: true,
    packages: { '': rootPackage }
  };
}

export function stringifyPackageLock(packageManifest) {
  return `${JSON.stringify(packageLockFor(packageManifest), null, 2)}\n`;
}
