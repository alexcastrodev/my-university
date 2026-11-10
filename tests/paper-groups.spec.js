import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { AnnotationShareControls } from './pages/AnnotationShareControls.js';
import { GroupPage } from './pages/GroupPage.js';
import { GroupsPage } from './pages/GroupsPage.js';
import { PaperDetailPage } from './pages/PaperDetailPage.js';
import { PaperLibraryEntryPage } from './pages/PaperLibraryEntryPage.js';

// Reading groups (#190): the owner starts a group, lists a public paper and writes on the board; a reader is
// invited and accepts; an annotation is shared into the group and only its members read it. Every reader is a
// user of its own (a browser context each); the owner deletes the groups, and the library entry, when a test ends.
const token = `gr${Math.random().toString(36).slice(2, 8)}`;
const PAPER = { id: 'metastable-failures-in-distributed-systems', title: 'Metastable Failures in Distributed Systems' };
let count = 0;
const unique = (label) => `${label} ${token}-${count++}`;

test.afterEach(async ({ page }) => {
  const mine = await page.request.get(`${BASE_URL}/api/paper-groups`);
  if (mine.ok()) {
    for (const group of (await mine.json()).items) {
      if (group.role === 'owner') await page.request.delete(`${BASE_URL}/api/paper-groups/${group.id}`);
    }
  }
  await page.request.delete(`${BASE_URL}/api/paper-library/${PAPER.id}`);
});

async function signIn(request, name) {
  const res = await request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `${name} ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

/** A reader whose public profile can be named: a context of its own, signed in, with a profile link. */
async function namedReader(browser, name) {
  const context = await browser.newContext();
  await signIn(context.request, name);
  const slug = `${name.toLowerCase()}-${token}`;
  const res = await context.request.put(`${BASE_URL}/api/auth/profile-slug`, { data: { slug } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { context, slug, name: `${name} ${token}`, page: await context.newPage() };
}

/** A group started through the API, with the paper on its list; the owner is whoever is signed in on `request`. */
async function startGroup(request, name, { withPaper = false } = {}) {
  const res = await request.post(`${BASE_URL}/api/paper-groups`, { data: { name } });
  expect(res.status(), await res.text()).toBe(201);
  const group = await res.json();
  if (withPaper) {
    const added = await request.put(`${BASE_URL}/api/paper-groups/${group.id}/papers/${PAPER.id}`);
    expect(added.status(), await added.text()).toBe(200);
  }
  return group;
}

/** The reader behind `reader` is invited by the owner (on `ownerRequest`) and accepts, all through the API. */
async function join(ownerRequest, groupId, reader) {
  const invited = await ownerRequest.post(`${BASE_URL}/api/paper-groups/${groupId}/invitations`, { data: { user: reader.slug } });
  expect(invited.status(), await invited.text()).toBe(201);
  const { id } = await invited.json();
  const accepted = await reader.context.request.post(`${BASE_URL}/api/paper-groups/invitations/${id}/accept`);
  expect(accepted.status(), await accepted.text()).toBe(201);
}

test.describe('the owner of a group', () => {
  test('starts a group, lists a public paper and writes on the board', async ({ page }) => {
    await signIn(page.request, 'Owner');
    const groups = new GroupsPage(page);
    await groups.goto();

    const name = unique('Circle');
    expect((await groups.create(name, 'We read failure papers together')).status()).toBe(201);
    const group = new GroupPage(page);
    await expect(group.title).toHaveText(name);
    await expect(group.role).toHaveText('Owner');

    expect((await group.addPaper('metastable', PAPER.title)).status()).toBe(200);
    await expect(group.paper(PAPER.title)).toBeVisible();
    await expect(group.result(PAPER.title)).toContainText('On the list');

    await group.openTab('Board');
    const text = unique('Retry storms');
    expect((await group.write(`${text} **sustain** it <img src=x onerror=alert(1)>`, PAPER.title)).status()).toBe(201);
    await expect(group.post(text)).toBeVisible();
    // The words are shown as written: Markdown works, raw HTML is text.
    await expect(group.post(text).locator('strong')).toHaveText('sustain');
    await expect(group.post(text).locator('app-annotation-text img')).toHaveCount(0);
    await expect(group.post(text)).toContainText('<img src=x onerror=alert(1)>');
    await expect(group.post(text).getByRole('link', { name: PAPER.title })).toBeVisible();

    expect((await group.removePost(text)).status()).toBe(204);
    await expect(group.post(text)).toHaveCount(0);

    await groups.goto();
    await expect(groups.card(name)).toContainText('Owner');
    await expect(groups.card(name)).toContainText('1 paper');
  });

  test('deletes the group for everyone', async ({ page }) => {
    await signIn(page.request, 'Owner');
    const name = unique('Short lived');
    const { id } = await startGroup(page.request, name);
    const group = new GroupPage(page);
    await group.goto(id);
    await expect(group.title).toHaveText(name);

    expect((await group.deleteGroup()).status()).toBe(204);
    const groups = new GroupsPage(page);
    await expect(groups.heading).toBeVisible();
    await expect(groups.card(name)).toHaveCount(0);

    await group.goto(id);
    await expect(group.missing).toBeVisible();
  });
});

test.describe('inviting a reader', () => {
  test('the reader accepts, joins as a plain member, and the owner makes them a moderator', async ({ page, browser }) => {
    await signIn(page.request, 'Owner');
    const name = unique('Study group');
    const { id } = await startGroup(page.request, name);
    const bruno = await namedReader(browser, 'Bruno');

    const owner = new GroupPage(page);
    await owner.goto(id, 'members');
    expect((await owner.invite(`${BASE_URL}/u/${bruno.slug}`)).status()).toBe(201);
    await expect(owner.pending.filter({ hasText: bruno.name })).toBeVisible();

    // Nothing is joined until the invitee answers.
    const theirGroups = new GroupsPage(bruno.page);
    await theirGroups.goto();
    await expect(theirGroups.invitation(name)).toBeVisible();
    await expect(theirGroups.card(name)).toHaveCount(0);
    expect((await theirGroups.accept(name)).status()).toBe(201);
    await expect(theirGroups.card(name)).toContainText('Member');
    await expect(theirGroups.invitation(name)).toHaveCount(0);

    // A plain member reads, and has none of the controls of the owner.
    const member = new GroupPage(bruno.page);
    await member.goto(id, 'members');
    await expect(member.role).toHaveText('Member');
    await expect(member.member(bruno.name)).toContainText('You');
    await expect(member.inviteField).toHaveCount(0);
    await expect(member.delete).toHaveCount(0);
    await expect(member.rename).toHaveCount(0);
    await expect(member.leave).toBeVisible();

    await owner.goto(id, 'members');
    await expect(owner.member(bruno.name)).toBeVisible();
    await expect(owner.pending).toHaveCount(0);
    expect((await owner.setRole(bruno.name, 'moderator')).status()).toBe(200);
    await expect(owner.member(bruno.name)).toContainText('Moderator');

    // A moderator invites too.
    await member.goto(id, 'members');
    await expect(member.role).toHaveText('Moderator');
    await expect(member.inviteField).toBeVisible();

    expect((await member.leaveGroup()).status()).toBe(204);
    await expect(theirGroups.heading).toBeVisible();
    await expect(theirGroups.card(name)).toHaveCount(0);
    await member.goto(id);
    await expect(member.missing).toBeVisible();
    await bruno.context.close();
  });

  test('a name nobody has is told so, and a reader can decline', async ({ page, browser }) => {
    await signIn(page.request, 'Owner');
    const name = unique('Closed group');
    const { id } = await startGroup(page.request, name);
    const bruno = await namedReader(browser, 'Bruno');

    const owner = new GroupPage(page);
    await owner.goto(id, 'members');
    expect((await owner.invite(`nobody-${token}`)).status()).toBe(400);
    await expect(owner.problem).toContainText('No reader has that public profile');

    expect((await owner.invite(bruno.slug)).status()).toBe(201);
    const theirGroups = new GroupsPage(bruno.page);
    await theirGroups.goto();
    expect((await theirGroups.decline(name)).status()).toBe(204);
    await expect(theirGroups.invitation(name)).toHaveCount(0);
    await expect(theirGroups.card(name)).toHaveCount(0);
    await bruno.context.close();
  });
});

test.describe('sharing an annotation into a group', () => {
  test('members read it, a reader outside and the paper page do not, and the owner can take it out', async ({ page, browser }) => {
    await signIn(page.request, 'Owner');
    const added = await page.request.post(`${BASE_URL}/api/paper-library`, { data: { paperId: PAPER.id } });
    expect(added.ok(), await added.text()).toBeTruthy();
    const name = unique('Readers');
    const other = unique('Another circle');
    const { id } = await startGroup(page.request, name, { withPaper: true });
    await startGroup(page.request, other);
    const bruno = await namedReader(browser, 'Bruno');
    await join(page.request, id, bruno);

    const text = unique('Retry storms keep it alive');
    const entry = new PaperLibraryEntryPage(page);
    await entry.goto(PAPER.id);
    expect((await entry.addNote(text)).status()).toBe(201);

    // Only a group that has the paper on its list can be picked.
    const controls = new AnnotationShareControls(entry.item(text));
    await controls.start.click();
    await controls.groups.check();
    await expect(controls.panel.getByLabel(name, { exact: true })).toBeVisible();
    await expect(controls.panel.getByLabel(other, { exact: true })).toHaveCount(0);
    await expect(controls.send).toBeDisabled();
    await controls.cancel.click();

    expect((await controls.shareWithGroups([name])).status()).toBe(200);
    await expect(controls.status).toContainText(`Shared with the reading groups ${name}`);

    // A member reads it, with who wrote it, and cannot take it out.
    const member = new GroupPage(bruno.page);
    await member.goto(id, 'annotations');
    await expect(member.annotation(text)).toBeVisible();
    await expect(member.annotation(text)).toContainText(`Owner ${token}`);
    await expect(member.annotation(text)).toContainText(PAPER.title);
    await expect(member.takeOutButton(text)).toHaveCount(0);

    // Someone who is not in the group does not even learn that it exists.
    const stranger = await namedReader(browser, 'Carla');
    const outside = new GroupPage(stranger.page);
    await outside.goto(id, 'annotations');
    await expect(outside.missing).toBeVisible();
    await expect(outside.annotations).toHaveCount(0);
    await stranger.context.close();

    // It is a copy for the group: the paper's public page shows nothing of it.
    const visitor = await browser.newContext();
    const detail = new PaperDetailPage(await visitor.newPage());
    await detail.gotoWithShares(PAPER.id);
    await expect(detail.sharedItem(text)).toHaveCount(0);
    await visitor.close();

    // The owner takes it out of the group: it is no longer shared with anyone, and the note itself stays.
    const owner = new GroupPage(page);
    await owner.goto(id, 'annotations');
    await expect(owner.takeOutButton(text)).toBeVisible();
    expect((await owner.takeOut(text)).status()).toBe(204);
    await expect(owner.annotation(text)).toHaveCount(0);
    await member.goto(id, 'annotations');
    await expect(member.annotation(text)).toHaveCount(0);
    await entry.goto(PAPER.id);
    await expect(entry.item(text)).toBeVisible();
    await expect(new AnnotationShareControls(entry.item(text)).status).toHaveCount(0);
    await bruno.context.close();
  });

  test('says so when none of the groups has the paper yet', async ({ page }) => {
    await signIn(page.request, 'Owner');
    const added = await page.request.post(`${BASE_URL}/api/paper-library`, { data: { paperId: PAPER.id } });
    expect(added.ok(), await added.text()).toBeTruthy();
    await startGroup(page.request, unique('Empty list'));
    const entry = new PaperLibraryEntryPage(page);
    await entry.goto(PAPER.id);
    const text = unique('A note');
    expect((await entry.addNote(text)).status()).toBe(201);

    const controls = new AnnotationShareControls(entry.item(text));
    await controls.start.click();
    await controls.groups.check();
    await expect(controls.noGroups).toBeVisible();
    await expect(controls.send).toBeDisabled();
  });
});
