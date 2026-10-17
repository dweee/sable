const [repository, tag, commit] = process.argv.slice(2);
if (!repository || !tag || !/^[a-f0-9]{40}$/.test(commit ?? '')) {
  throw new Error('Usage: verify-forgejo-release-tag.mjs <repository-url> <tag> <commit-sha>');
}
const url = new URL(repository);
const repositoryPath = url.pathname.replace(/\/$/, '').replace(/\.git$/, '');
const endpoint = new URL(`/api/v1/repos${repositoryPath}/tags/${encodeURIComponent(tag)}`, url.origin);
const response = await fetch(endpoint, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) {
  throw new Error(`Create the release tag ${tag} in canonical Forgejo first (HTTP ${response.status}).`);
}
const canonical = await response.json();
if (canonical.commit?.sha !== commit) {
  throw new Error(`Canonical Forgejo tag ${tag} does not identify the built commit ${commit}.`);
}
console.log(`Verified canonical Forgejo release tag ${tag} at ${commit}.`);
