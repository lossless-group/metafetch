import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenshotFromResponse, screenshotRequestUrl } from '../src/services/microlinkScreenshotService';
import { screenshotFileName, screenshotTarget } from '../src/commands/fetchScreenshotIntoNote';
import { upsertSection } from '../src/utils/screenshotsSection';

test('screenshotRequestUrl asks for the screenshot only', () => {
    assert.equal(
        screenshotRequestUrl('https://linear.app/?a=1'),
        'https://api.microlink.io?url=https%3A%2F%2Flinear.app%2F%3Fa%3D1&screenshot=true&meta=false',
    );
});

test('screenshotFromResponse reads data.screenshot', () => {
    assert.deepEqual(
        screenshotFromResponse({ status: 'success', data: { screenshot: { url: 'https://iad.microlink.io/x.png', type: 'png', width: 2560, height: 1600 } } }),
        { url: 'https://iad.microlink.io/x.png', type: 'png', width: 2560, height: 1600 },
    );
    assert.equal(screenshotFromResponse({ status: 'success', data: {} }), null);
    assert.equal(screenshotFromResponse({ status: 'fail', message: 'nope' }), null);
    assert.equal(screenshotFromResponse(null), null);
});

test('screenshotTarget prefers url, else the only URL property', () => {
    assert.equal(screenshotTarget({ url: 'https://linear.app', github: 'https://github.com/x' }), 'https://linear.app');
    assert.equal(screenshotTarget({ arxiv: 'https://arxiv.org/abs/1' }), 'https://arxiv.org/abs/1');
    assert.equal(screenshotTarget({ a: 'https://a.com', b: 'https://b.com' }), null);
    assert.equal(screenshotTarget({ og_image: 'https://cdn/x.png' }), null);
});

test('screenshotFileName slugs the note name and dates the file', () => {
    assert.equal(screenshotFileName('Linear App', new Date(2026, 10, 6), 'png'), 'linear-app-screenshot-2026-11-06.png');
    assert.equal(screenshotFileName('Chat GPT!', new Date(2026, 0, 2), 'jpeg'), 'chat-gpt-screenshot-2026-01-02.jpg');
});

test('upsertSection replaces placeholder text, keeps existing images', () => {
    assert.equal(
        upsertSection('## Screenshots\nNone publicly available.\n\n## Roadmap\n', 'Screenshots', '![[s.png]]'),
        '## Screenshots\n\n![[s.png]]\n\n## Roadmap\n',
    );
    assert.equal(
        upsertSection('## Screenshots\n\n![a](u)\n', 'Screenshots', '![[s.png]]'),
        '## Screenshots\n\n![a](u)\n\n![[s.png]]\n',
    );
    assert.equal(upsertSection('Intro', 'Screenshots', 'X'), 'Intro\n\n## Screenshots\n\nX\n');
});
