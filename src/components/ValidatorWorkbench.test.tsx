import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ValidatorWorkbench } from './ValidatorWorkbench';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, language }: { value: string; onChange: (value: string) => void; language: string }) => (
    <textarea aria-label={`mock-editor-${language}`} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

describe('ValidatorWorkbench', () => {
  it('renders the validation workspace and shows diagnostics', async () => {
    render(<ValidatorWorkbench />);

    expect(screen.getByRole('heading', { name: /schema validator workbench/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /validate/i })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/Missing required field: quantity/i)).toBeInTheDocument());
    expect(screen.getByText(/Unexpected field: debug/i)).toBeInTheDocument();
  });

  it('loads a passing fixture and reports success', async () => {
    const user = userEvent.setup();
    render(<ValidatorWorkbench />);

    await user.selectOptions(screen.getByLabelText(/fixture/i), 'json-schema-valid');
    await waitFor(() => expect(screen.getByRole('heading', { name: /validation passed/i })).toBeInTheDocument());
  });
});
