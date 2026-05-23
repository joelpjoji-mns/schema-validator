import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeIssue } from '../validation/textRanges';
import type { ValidationResult } from '../validation/types';
import { DiagnosticsPanel } from './DiagnosticsPanel';

describe('DiagnosticsPanel', () => {
  it('shows expected, actual, and hint context for enriched diagnostics', () => {
    const result: ValidationResult = {
      ok: false,
      adapterId: 'xml-xsd',
      summary: 'XML + XSD validation found 1 error.',
      durationMs: 12,
      issues: [
        makeIssue({
          code: 'missing-xml-element',
          title: 'MessageId is missing before CreatedTimestamp',
          message: '<MessageId> is required before <CreatedTimestamp> under /ShipmentNotification/Header.',
          path: '/ShipmentNotification/Header/MessageId',
          expected: '<MessageId> before <CreatedTimestamp>',
          actual: '<CreatedTimestamp>',
          hint: 'Add <MessageId>...</MessageId> before <CreatedTimestamp>.',
        }),
      ],
    };

    render(<DiagnosticsPanel result={result} onIssueSelect={vi.fn()} />);

    expect(screen.getByText('MessageId is missing before CreatedTimestamp')).toBeInTheDocument();
    expect(screen.getByText('Expected: <MessageId> before <CreatedTimestamp>')).toBeInTheDocument();
    expect(screen.getByText('Actual: <CreatedTimestamp>')).toBeInTheDocument();
    expect(screen.getByText(/Hint: Add <MessageId>/)).toBeInTheDocument();
  });
});
