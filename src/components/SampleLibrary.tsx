import { FlaskConical } from 'lucide-react';
import { samples, type ValidationSample } from '../fixtures/samples';

interface SampleLibraryProps {
  activeSampleId: string;
  onSampleSelect: (sample: ValidationSample) => void;
}

export function SampleLibrary({ activeSampleId, onSampleSelect }: SampleLibraryProps) {
  return (
    <label className="sample-select">
      <FlaskConical aria-hidden="true" size={16} />
      <span>Fixture</span>
      <select
        value={activeSampleId}
        onChange={(event) => {
          const sample = samples.find((item) => item.id === event.target.value);
          if (sample) {
            onSampleSelect(sample);
          }
        }}
      >
        {samples.map((sample) => (
          <option key={sample.id} value={sample.id}>
            {sample.expected === 'pass' ? 'Pass' : 'Fail'} - {sample.label}
          </option>
        ))}
      </select>
    </label>
  );
}
