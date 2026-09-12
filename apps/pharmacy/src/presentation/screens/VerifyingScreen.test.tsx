import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CHECK_ORDER, pendingChecks, type CheckResult } from '../../domain/verification';
import { CONTENT_HASH } from '../../test/fixtures';
import { VerifyingScreen } from './VerifyingScreen';

/**
 * docs/17, P3: "Cinco comprobaciones, cinco líneas. (...) Colapsarlas en un
 * spinner impide que el farmacéutico sepa qué falló cuando algo falle."
 */

const NAMES = [
  /registrada en la cadena/i,
  /no dispensada y dentro de vigencia/i,
  /integridad del contenido/i,
  /firma del prescriptor/i,
  /correspondencia con el paciente/i,
];

function rows(): HTMLElement[] {
  return screen.getAllByRole('listitem');
}

describe('the five checks', () => {
  it('renders one named sentence per check, in pipeline order', () => {
    render(<VerifyingScreen checks={pendingChecks()} contentHash={CONTENT_HASH} />);

    const items = rows();
    expect(items).toHaveLength(CHECK_ORDER.length);
    items.forEach((item, index) => {
      expect(item).toHaveTextContent(NAMES[index] as RegExp);
    });
  });

  it('is not a spinner: every check is readable before any answer arrives', () => {
    render(<VerifyingScreen checks={pendingChecks()} contentHash={CONTENT_HASH} />);

    const list = screen.getByRole('list');
    for (const name of NAMES) {
      expect(within(list).getByText(name)).toBeInTheDocument();
    }
  });

  it('marks the first unanswered check as the current one', () => {
    render(<VerifyingScreen checks={pendingChecks()} contentHash={CONTENT_HASH} />);

    expect(rows()[0]).toHaveClass('steps__item--current');
    expect(rows()[1]).not.toHaveClass('steps__item--current');
  });

  it('advances the current marker as answers arrive', () => {
    const partial: CheckResult[] = [
      { id: 'registered', state: 'passed' },
      { id: 'not-dispensed', state: 'passed' },
      { id: 'integrity', state: 'pending' },
      { id: 'prescriber-signature', state: 'pending' },
      { id: 'patient-commitment', state: 'pending' },
    ];

    render(<VerifyingScreen checks={partial} contentHash={CONTENT_HASH} />);

    const items = rows();
    expect(items[0]).toHaveClass('steps__item--done');
    expect(items[1]).toHaveClass('steps__item--done');
    expect(items[2]).toHaveClass('steps__item--current');
    expect(items[3]).not.toHaveClass('steps__item--current');
  });

  it('marks a failed check as answered and leaves the skipped ones unmarked', () => {
    const rejected: CheckResult[] = [
      { id: 'registered', state: 'passed' },
      { id: 'not-dispensed', state: 'failed' },
      { id: 'integrity', state: 'skipped' },
      { id: 'prescriber-signature', state: 'skipped' },
      { id: 'patient-commitment', state: 'skipped' },
    ];

    render(<VerifyingScreen checks={rejected} contentHash={CONTENT_HASH} />);

    const items = rows();
    expect(items[1]).toHaveClass('steps__item--done');
    // A skipped check gathered no evidence, so it must not read as a tick.
    expect(items[2]).not.toHaveClass('steps__item--done');
    expect(items[2]).not.toHaveClass('steps__item--current');
  });
});

describe('accessibility', () => {
  // docs/17: colour is never the only carrier of meaning.
  it('states the outcome of every check in words, not only in colour', () => {
    const partial: CheckResult[] = [
      { id: 'registered', state: 'passed' },
      { id: 'not-dispensed', state: 'failed' },
      { id: 'integrity', state: 'skipped' },
      { id: 'prescriber-signature', state: 'pending' },
      { id: 'patient-commitment', state: 'pending' },
    ];

    render(<VerifyingScreen checks={partial} contentHash={CONTENT_HASH} />);

    const items = rows();
    expect(within(items[0] as HTMLElement).getByText(/comprobado/i)).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText(/no superado/i)).toBeInTheDocument();
    expect(within(items[2] as HTMLElement).getByText(/sin comprobar/i)).toBeInTheDocument();
    expect(within(items[3] as HTMLElement).getByText(/pendiente/i)).toBeInTheDocument();
  });

  it('announces progress to a screen reader', () => {
    render(<VerifyingScreen checks={pendingChecks()} contentHash={CONTENT_HASH} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/registrada en la cadena/i);
  });
});
