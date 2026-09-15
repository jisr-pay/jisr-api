# Pinned Jisr SDK artifact

The API installs the compiled v0.3.0 tarball through a repository-relative file
dependency, with integrity pinned in package-lock.json. This avoids requiring a
registry release or a sibling checkout. Source and artifact hashes are recorded
in jisr-sdk-provenance.json. The web and standalone SDK source trees were equal.

Rebuild from the recorded web commit: install its pinned workspace dependencies,
then run npm pack inside lib/jisr-sdk. Review the source diff and artifact hash
before replacing this file. Update the lockfile, provenance, and run npm ci,
npm run check:sdk, npm test and npm run build. The artifact is not an npm-registry
publication. The original SDK MIT license is included here.
