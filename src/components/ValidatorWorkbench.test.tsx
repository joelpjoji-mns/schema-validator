import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ValidatorWorkbench } from './ValidatorWorkbench';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, language }: { value: string; onChange: (value: string) => void; language: string }) => (
    <textarea aria-label={`mock-editor-${language}`} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

describe('ValidatorWorkbench', () => {
  it('starts without fixture text and waits for input', () => {
    render(<ValidatorWorkbench />);

    expect(screen.getByRole('heading', { name: /schema validator workbench/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /validate/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/fixture/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Run validation to see diagnostics/i)).toBeInTheDocument();

    const editors = screen.getAllByRole('textbox');
    expect(editors[0]).toHaveValue('');
    expect(editors[1]).toHaveValue('');
  });

  it('auto-detects XSD and renders a schema summary tree', async () => {
    const user = userEvent.setup();
    render(<ValidatorWorkbench />);

    const [schemaEditor] = screen.getAllByRole('textbox');
    fireEvent.change(schemaEditor, {
      target: {
        value: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="ShipmentNotification">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Header" type="HeaderType" />
        <xs:element name="Payload" type="xs:string" minOccurs="0" />
      </xs:sequence>
    </xs:complexType>
  </xs:element>
  <xs:complexType name="HeaderType">
    <xs:sequence>
      <xs:element name="CorrelationID" type="xs:string" />
    </xs:sequence>
  </xs:complexType>
</xs:schema>`,
      },
    });

    await waitFor(() => expect(screen.getByText(/Detected: XSD/i)).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: /summary/i }));
    expect(screen.getByText('ShipmentNotification')).toBeInTheDocument();
    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Payload')).toBeInTheDocument();
    expect(screen.getAllByText(/mandatory|optional/i).length).toBeGreaterThan(0);
  });

  it('reruns validation after message edits', async () => {
    render(<ValidatorWorkbench />);

    const [schemaEditor, messageEditor] = screen.getAllByRole('textbox');
    fireEvent.change(schemaEditor, {
      target: {
        value: JSON.stringify({
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        }),
      },
    });
    fireEvent.change(messageEditor, { target: { value: '{"name":"Joel"}' } });

    await waitFor(() => expect(screen.getByRole('heading', { name: /validation passed/i })).toBeInTheDocument());

    fireEvent.change(messageEditor, { target: { value: '{}' } });

    await waitFor(() => expect(screen.getByText(/Missing required field: name/i)).toBeInTheDocument());
  });
});
