// utils/github.js
import { Octokit } from '@octokit/rest';
import fs from 'fs';

export async function pushToGitHub(filename, filepath) {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const content = fs.readFileSync(filepath, 'base64');

  await octokit.repos.createOrUpdateFileContents({
    owner: 'Nethupa222222',
    repo: 'Shadow-x-session',
    path: `sessions/${filename}.json`,
    message: '🔁 New session pushed automatically',
    content,
    committer: { name: 'SHADOW-X BOT', email: 'bot@shadowx.com' },
    author: { name: 'SHADOW-X BOT', email: 'bot@shadowx.com' },
  });
}
