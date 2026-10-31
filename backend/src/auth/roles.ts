/**
 * Who may do what with a paper's Research Analysis. Roles live on the user row (granted by whoever runs
 * the database), not in an environment list: a GitHub login can be renamed and claimed by someone else,
 * the user id cannot. There is no way to grant a role over HTTP outside the dev-only test route.
 */
export const PAPER_CURATOR = 'paper-curator';
export const PAPER_REVIEWER = 'paper-reviewer';
export const ROLES = [PAPER_CURATOR, PAPER_REVIEWER] as const;
export type Role = (typeof ROLES)[number];
