import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Stepper } from '../src/components/shared/Stepper.tsx';
import { getSuccessfulUploadUrls } from '../src/platform/images/supabaseImageUpload.ts';
import { getRemoteCatalogueImageUrl } from '../src/features/sync/supabaseSync.ts';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));

test('the reservation stepper exposes the active step and phone-sized controls', () => {
  const steps = [
    { id: 'customer', label: 'العميلة' },
    { id: 'dates', label: 'التواريخ' },
    { id: 'items', label: 'القطع' },
    { id: 'summary', label: 'الملخص' },
  ];
  const markup = renderToStaticMarkup(React.createElement(Stepper, {
    steps,
    currentStep: 2,
    onStepChange: () => {},
    idPrefix: 'reservation',
  }));

  assert.match(markup, /aria-label="خطوات إنشاء الحجز"/);
  assert.match(markup, /aria-current="step"/);
  assert.match(markup, /aria-controls="reservation-panel-items"/);
  assert.match(markup, /الخطوة 3 من 4: القطع/);
  assert.match(markup, /h-11 w-11/, 'step controls must be at least 44px on phones');
});

test('the reservation modal is a real validated four-panel wizard', async () => {
  const modal = await readFile(join(sourceRoot, 'features/reservations/CreateReservationModal.tsx'), 'utf8');

  for (const step of [0, 1, 2, 3]) {
    assert.match(modal, new RegExp(`currentStep === ${step}`), `step ${step} needs its own panel`);
  }
  assert.match(modal, /trigger\('customerId', \{ shouldFocus: true \}\)/, 'customer selection must be validated before advancing');
  assert.match(modal, /\['pickupDate', 'pickupTime', 'returnDate', 'returnTime'\]/, 'the complete period must be validated before advancing');
  assert.match(modal, /returnDate <= pickupDate/, 'the wizard must reject a non-forward rental period');
  assert.match(modal, /if \(!hasSelectedLine\)/, 'the review step must not open without an item');
  assert.match(modal, />\s*السابق\s*</, 'the operator must be able to go back without losing entered data');
  assert.match(modal, />\s*التالي\s*</, 'the wizard needs an explicit forward action');
  assert.match(modal, /resetStep\(\)/, 'reopening the modal must start at the first step');
});

test('partial image uploads preserve result identity and use only successful public URLs', () => {
  const outcomes = [
    { sourceIndex: 0, result: null },
    {
      sourceIndex: 1,
      result: {
        path: 'dress-1/image.webp',
        publicUrl: 'https://cdn.example.com/dress-1/image.webp',
        bytes: 512,
      },
    },
  ];

  assert.deepEqual(getSuccessfulUploadUrls(outcomes), ['https://cdn.example.com/dress-1/image.webp']);
  assert.deepEqual(outcomes.map((outcome) => outcome.sourceIndex), [0, 1]);
});

test('Supabase rows never receive local base64 or executable image URLs', () => {
  assert.equal(getRemoteCatalogueImageUrl(['data:image/webp;base64,AAAA']), null);
  assert.equal(getRemoteCatalogueImageUrl(['javascript:alert(1)']), null);
  assert.equal(
    getRemoteCatalogueImageUrl([
      'data:image/webp;base64,AAAA',
      'https://cdn.example.com/catalogue/image.webp',
    ]),
    'https://cdn.example.com/catalogue/image.webp',
  );
});

test('catalogue image sync keeps the compressed local record as the failure fallback', async () => {
  const service = await readFile(join(sourceRoot, 'features/dresses/dress.service.ts'), 'utf8');
  const uploader = await readFile(join(sourceRoot, 'platform/images/supabaseImageUpload.ts'), 'utf8');

  assert.match(service, /publicImageUrls = getSuccessfulUploadUrls\(outcomes\)/);
  assert.match(service, /void syncCreatedDressBestEffort\(newDress\)/, 'record and image sync must use one ordered task');
  assert.doesNotMatch(service, /void pushDressBestEffort\(newDress\)/, 'parallel create and image pushes can overwrite the public URL');
  assert.match(service, /The local compressed images stay intact and can be retried later/);
  assert.doesNotMatch(service, /results\.map\(\(r:/, 'a partial result must not overwrite the local image array');
  assert.match(uploader, /if \(!sessionData\.session\) return null/, 'anonymous uploads are forbidden by the storage policy');
  assert.match(uploader, /outcomes\.push\(\{ sourceIndex, result \}\)/, 'one outcome must be retained for every source image');
  assert.doesNotMatch(uploader, /no-explicit-any/, 'the adapter must not disable type safety');
});
