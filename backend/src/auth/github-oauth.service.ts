import { Injectable } from '@nestjs/common';

const USER_AGENT = 'ocp-java-25';

export interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

@Injectable()
export class GithubOauthService {
  buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID ?? '',
      redirect_uri: process.env.GITHUB_CALLBACK_URL ?? '',
      scope: 'read:user',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<string> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID ?? '',
        client_secret: process.env.GITHUB_CLIENT_SECRET ?? '',
        code,
        redirect_uri: process.env.GITHUB_CALLBACK_URL ?? '',
      }),
    });
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error('GitHub token exchange failed');
    return body.access_token;
  }

  async fetchProfile(accessToken: string): Promise<GithubProfile> {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': USER_AGENT,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) throw new Error('GitHub profile fetch failed');
    return res.json() as Promise<GithubProfile>;
  }
}
