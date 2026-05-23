import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateRequest } from '../validation/registry';
import type { ValidationResult } from '../validation/types';
import { EditorPane } from './EditorPane';
import { ValidatorWorkbench } from './ValidatorWorkbench';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, language }: { value: string; onChange: (value: string) => void; language: string }) => (
    <textarea aria-label={`mock-editor-${language}`} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

vi.mock('../validation/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../validation/registry')>();
  return {
    ...actual,
    validateRequest: vi.fn(actual.validateRequest),
  };
});

const mockedValidateRequest = vi.mocked(validateRequest);

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  mockedValidateRequest.mockReset();
  mockedValidateRequest.mockImplementation(async (request) => {
    const actual = await vi.importActual<typeof import('../validation/registry')>('../validation/registry');
    return actual.validateRequest(request);
  });
});

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

    expect(screen.getByLabelText('Required')).toBeChecked();
    expect(screen.getByLabelText('Optional')).toBeChecked();
    expect(screen.getByLabelText('Order')).not.toBeChecked();
    expect(screen.getByLabelText('Types')).not.toBeChecked();
    expect(screen.getByLabelText('Limits')).not.toBeChecked();
    expect(screen.getByLabelText('Docs')).not.toBeChecked();
    expect(screen.getByLabelText('Warnings')).not.toBeChecked();

    const tree = within(screen.getByRole('tree'));
    expect(tree.queryByText(/xs:string/)).not.toBeInTheDocument();
    expect(tree.queryByText('#1')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Types'));
    expect(tree.getAllByText(/xs:string/).length).toBeGreaterThan(0);

    await user.click(screen.getByLabelText('Order'));
    expect(tree.getAllByText('#1').length).toBeGreaterThan(0);
  });

  it('opens command palette, toggles theme, and switches message preview', async () => {
    const user = userEvent.setup();
    render(<ValidatorWorkbench />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /validate now/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /open message preview/i }));
    expect(screen.getByText(/No message preview/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /toggle theme/i }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('persists workspace text and restores it on the next mount', async () => {
    const { unmount } = render(<ValidatorWorkbench />);

    const [schemaEditor, messageEditor] = screen.getAllByRole('textbox');
    fireEvent.change(schemaEditor, { target: { value: '{"type":"object"}' } });
    fireEvent.change(messageEditor, { target: { value: '{"name":"Joel"}' } });

    await waitFor(() => expect(window.localStorage.getItem('schema-validator.workspace.v2')).toContain('Joel'));
    unmount();
    render(<ValidatorWorkbench />);

    const restoredEditors = screen.getAllByRole('textbox');
    expect(restoredEditors[0]).toHaveValue('{"type":"object"}');
    expect(restoredEditors[1]).toHaveValue('{"name":"Joel"}');
  });

  it('saves and loads named workspace presets', async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Customer payload');
    render(<ValidatorWorkbench />);

    const [schemaEditor] = screen.getAllByRole('textbox');
    fireEvent.change(schemaEditor, { target: { value: '{"type":"object","properties":{"id":{"type":"string"}}}' } });

    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect((screen.getByRole('combobox', { name: /preset/i }) as HTMLSelectElement).value).toMatch(/^preset-/);

    fireEvent.change(schemaEditor, { target: { value: '{"type":"array"}' } });
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(screen.getAllByRole('textbox')[0]).toHaveValue('{"type":"object","properties":{"id":{"type":"string"}}}');
    promptSpy.mockRestore();
  });

  it('renders message preview, schema insights, and comparison baseline', async () => {
    const user = userEvent.setup();
    render(<ValidatorWorkbench />);

    const [schemaEditor, messageEditor] = screen.getAllByRole('textbox');
    fireEvent.change(schemaEditor, {
      target: {
        value: JSON.stringify({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' }, email: { type: 'string' } },
        }),
      },
    });
    fireEvent.change(messageEditor, { target: { value: '{"name":"Joel"}' } });

    await user.click(screen.getByRole('tab', { name: /preview/i }));
    expect(screen.getByText(/JSON structure/i)).toBeInTheDocument();
    expect(screen.getByText(/"name": "Joel"/i)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /insights/i }));
    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText(/Message Coverage/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save baseline/i }));
    expect(screen.getByText(/baseline saved/i)).toBeInTheDocument();
  });

  it('searches, filters, groups diagnostics, and shows suggested fixes', async () => {
    const user = userEvent.setup();
    render(<ValidatorWorkbench />);

    const [schemaEditor, messageEditor] = screen.getAllByRole('textbox');
    fireEvent.change(schemaEditor, {
      target: {
        value: JSON.stringify({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        }),
      },
    });
    fireEvent.change(messageEditor, { target: { value: '{"extra": true}' } });

    await waitFor(() => expect(screen.getByText(/Missing required field: name/i)).toBeInTheDocument());
  expect(screen.getAllByText(/Fix:/i).length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText(/search diagnostics/i), 'required');
    expect(screen.getByText(/visible/i)).toBeInTheDocument();
    const filters = within(screen.getByLabelText(/diagnostic filters/i));
    await user.selectOptions(filters.getByLabelText(/group/i), 'code');
    expect(screen.getAllByText(/missing-required-field/i).length).toBeGreaterThan(0);
    await user.selectOptions(filters.getByLabelText(/severity/i), 'warning');
    expect(screen.getByText(/No diagnostics match/i)).toBeInTheDocument();
  });

  it('renders recursive XSD summary references without the old expansion warning', async () => {
    const user = userEvent.setup();
    render(<ValidatorWorkbench />);

    const [schemaEditor] = screen.getAllByRole('textbox');
    fireEvent.change(schemaEditor, {
      target: {
        value: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Shipment" type="ShipmentType" />
  <xs:complexType name="ShipmentType">
    <xs:sequence>
      <xs:element name="ShipmentID" type="xs:string" />
      <xs:element name="ChildShipment" type="ShipmentType" minOccurs="0" />
    </xs:sequence>
  </xs:complexType>
</xs:schema>`,
      },
    });

    await waitFor(() => expect(screen.getByText(/Detected: XSD/i)).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /summary/i }));

    const tree = within(screen.getByRole('tree'));
    expect(tree.getByText('ShipmentID')).toBeInTheDocument();
    expect(tree.getByText('ChildShipment')).toBeInTheDocument();
    expect(tree.getByText('recursive ref')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Warnings'));
    expect(screen.getByText('Recursive reference to ShipmentType.')).toBeInTheDocument();
    expect(screen.queryByText(/Recursive XSD type ShipmentType was not expanded again/i)).not.toBeInTheDocument();
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

  it('keeps the newest validation result when an older run finishes late', async () => {
    const firstRun = deferred<ValidationResult>();
    const secondRun = deferred<ValidationResult>();
    mockedValidateRequest
      .mockImplementationOnce(() => firstRun.promise)
      .mockImplementationOnce(() => secondRun.promise);

    render(<ValidatorWorkbench />);

    const [schemaEditor, messageEditor] = screen.getAllByRole('textbox');
    fireEvent.change(schemaEditor, { target: { value: '{"type":"object"}' } });
    fireEvent.change(messageEditor, { target: { value: '{"name":"Joel"}' } });

    await waitFor(() => expect(mockedValidateRequest).toHaveBeenCalledTimes(1));

    fireEvent.change(messageEditor, { target: { value: '{}' } });
    await waitFor(() => expect(mockedValidateRequest).toHaveBeenCalledTimes(2));

    secondRun.resolve({
      ok: false,
      adapterId: 'mock',
      summary: '1 validation issue found.',
      durationMs: 1,
      issues: [
        {
          id: 'newer-required-name',
          severity: 'error',
          code: 'required',
          title: 'Missing required field: name',
          message: 'The latest message is missing name.',
        },
      ],
    });

    await waitFor(() => expect(screen.getByText(/Missing required field: name/i)).toBeInTheDocument());

    firstRun.resolve({ ok: true, adapterId: 'mock', summary: 'Validation passed.', durationMs: 1, issues: [] });

    await waitFor(() => expect(screen.getByText(/Missing required field: name/i)).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: /validation passed/i })).not.toBeInTheDocument();
  });

  it('validates again when an included XSD source is added in the Sources tab', async () => {
    const user = userEvent.setup();
    render(<ValidatorWorkbench />);

    const [schemaEditor, messageEditor] = screen.getAllByRole('textbox');
    fireEvent.change(schemaEditor, {
      target: {
        value: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:include schemaLocation="header-types.xsd" />
  <xs:element name="ShipmentNotification">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Header" type="HeaderType" />
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`,
      },
    });
    fireEvent.change(messageEditor, {
      target: {
        value:
          '<ShipmentNotification><Header><EnvelopeVersion>1.0</EnvelopeVersion><Filter>Level2</Filter></Header></ShipmentNotification>',
      },
    });

    await waitFor(() => expect(screen.getAllByText(/XSD schema error/i).length).toBeGreaterThan(0));

    await user.click(screen.getByRole('tab', { name: /sources/i }));
    await user.click(screen.getByRole('button', { name: /add missing include source header-types\.xsd/i }));

    const sourcePanel = screen.getByLabelText('Selected XSD source');
    expect(within(sourcePanel).getByLabelText('Name')).toHaveValue('header-types.xsd');
    expect(within(sourcePanel).getByLabelText(/schemaLocation/i)).toHaveValue('header-types.xsd');
    fireEvent.change(within(sourcePanel).getByLabelText('mock-editor-xml'), {
      target: {
        value: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="HeaderType">
    <xs:sequence>
      <xs:element name="EnvelopeVersion" type="xs:string" />
      <xs:sequence>
        <xs:element name="Filter" type="xs:string" />
      </xs:sequence>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`,
      },
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: /validation passed/i })).toBeInTheDocument());
    expect(screen.queryByText(/Unsupported nested XSD particle/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /add missing include source header-types\.xsd/i }),
    ).not.toBeInTheDocument();
    expect(mockedValidateRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        relatedSchemas: [expect.objectContaining({ schemaLocation: 'header-types.xsd' })],
      }),
    );

    await user.click(screen.getByRole('tab', { name: /summary/i }));
    const tree = within(screen.getByRole('tree'));
    expect(tree.getByText('Header')).toBeInTheDocument();
    expect(tree.getByText('EnvelopeVersion')).toBeInTheDocument();
    expect(tree.getByText('Filter')).toBeInTheDocument();
  });

  it('prefills namespace imports from missing references', async () => {
    const user = userEvent.setup();
    render(<ValidatorWorkbench />);

    const [schemaEditor] = screen.getAllByRole('textbox');
    fireEvent.change(schemaEditor, {
      target: {
        value: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:common="https://example.test/common">
  <xs:import namespace="https://example.test/common" />
  <xs:element name="Envelope" type="common:EnvelopeType" />
</xs:schema>`,
      },
    });

    await waitFor(() => expect(screen.getByText(/Detected: XSD/i)).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /sources/i }));
    await user.click(
      screen.getByRole('button', { name: /add missing import source https:\/\/example\.test\/common/i }),
    );

    const sourcePanel = screen.getByLabelText('Selected XSD source');
    expect(within(sourcePanel).getByLabelText('Name')).toHaveValue('example-test-common.xsd');
    expect(within(sourcePanel).getByLabelText(/schemaLocation/i)).toHaveValue('');
    expect(within(sourcePanel).getByLabelText('Namespace')).toHaveValue('https://example.test/common');
    expect(within(sourcePanel).getByLabelText('mock-editor-xml')).toHaveValue(
      '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="https://example.test/common" elementFormDefault="qualified">\n</xs:schema>',
    );
  });

  it('shows a compact upload error when a selected file cannot be read', async () => {
    const { container } = render(<EditorPane title="Schema" language="xml" value="" issues={[]} onChange={vi.fn()} />);
    const input = container.querySelector('input[type="file"]');
    const unreadableFile = {
      name: 'broken.xsd',
      text: vi.fn().mockRejectedValue(new Error('read failed')),
    } as unknown as File;

    fireEvent.change(input as HTMLInputElement, { target: { files: [unreadableFile] } });

    expect(await screen.findByText('Could not read broken.xsd.')).toBeInTheDocument();
  });
});

const deferred = <TValue,>() => {
  let resolve!: (value: TValue) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};
