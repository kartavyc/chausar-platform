// B4 task 9: forms and controls look like one app. One label style, the app's select, file pick and radio rows, and one focus ring.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { Field } from '../../src/parts/Field';
import { FilePick } from '../../src/parts/FilePick';
import { CheckRow, OptionRows } from '../../src/parts/OptionRows';
import { Select } from '../../src/parts/Select';
import { TextProvider } from '../../src/text';
import { rule } from '../helpers/css';

const inText = (node: React.ReactNode) => render(<TextProvider language="en">{node}</TextProvider>);
const aFile = (name: string) => new File(['x'], name, { type: 'text/csv' });

describe('Field', () => {
  it('one label style for an input, a text area and a select', () => {
    inText(
      <>
        <Field label="A line" />
        <Field multiline label="Some lines" />
        <Select label="A choice"><option>One</option></Select>
      </>,
    );
    const classes = ['A line', 'Some lines', 'A choice'].map((name) => screen.getByText(name).className);
    expect(new Set(classes).size).toBe(1);
    expect(screen.getByLabelText('A choice').tagName).toBe('SELECT');
  });

  it('an adornment sits inside the box and is hidden from readers', () => {
    const { container } = inText(<Field label="Amount" adornment="INR" />);
    const mark = screen.getByText('INR');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.closest('[data-field-box]')!.contains(screen.getByLabelText('Amount'))).toBe(true);
    expect(container.querySelector('[data-field-box]')!.hasAttribute('data-adorned')).toBe(true);
    expect(rule('Field.module.css', '[data-adorned] > .input')).toContain('padding-inline-start');
  });

  it('a field with no adornment draws no extra box', () => {
    const { container } = inText(<Field label="Name" />);
    expect(container.querySelector('[data-field-box]')).toBeNull();
  });

  it('a single line stops at about 480 px; a text area does not', () => {
    const { container } = inText(<><Field label="Line" /><Field multiline label="Lines" /></>);
    const [line, lines] = [...container.querySelectorAll('[data-field]')];
    expect(line!.hasAttribute('data-single')).toBe(true);
    expect(lines!.hasAttribute('data-single')).toBe(false);
    expect(rule('Field.module.css', '[data-single] .input')).toContain('max-width: var(--field-max)');
  });

  it('a date is in the body face, with a plain word while it is empty', () => {
    expect(rule('Field.module.css', ".input[type='date']")).toContain('font-family: var(--font)');
    const { rerender } = inText(<Field label="From" type="date" value="" onChange={() => {}} />);
    expect(screen.getByText('Pick a day').getAttribute('aria-hidden')).toBe('true');
    rerender(<TextProvider language="en"><Field label="From" type="date" value="2026-11-03" onChange={() => {}} /></TextProvider>);
    expect(screen.queryByText('Pick a day')).toBeNull();
  });

  it('the ring on focus is one line, with no gap and no second colour', () => {
    const focus = rule('Field.module.css', '.input:focus-visible');
    expect(focus).toContain('outline: var(--focus) solid var(--link)');
    expect(focus).toContain('outline-offset: 0');
    expect(focus).not.toContain('border-color');
  });
});

describe('Select', () => {
  it('keeps a native select, in the app\'s box, with the app\'s arrow', () => {
    const { container } = inText(<Select aria-label="Sort"><option>New</option></Select>);
    const select = screen.getByRole('combobox', { name: 'Sort' });
    expect(select.tagName).toBe('SELECT');
    const arrow = container.querySelector('[data-select-arrow]')!;
    expect(arrow.getAttribute('aria-hidden')).toBe('true');
    expect(arrow.querySelector('svg')).not.toBeNull();
    expect(rule('Select.module.css', '.wrap > select')).toContain('appearance: none');
  });

  it('passes its attributes to the select, and a hint and an error describe it', () => {
    const onChange = vi.fn();
    inText(
      <Select label="Who" hint="Pick one" error="Pick someone" value="b" onChange={onChange} data-who="">
        <option value="a">A</option><option value="b">B</option>
      </Select>,
    );
    const select = screen.getByLabelText('Who') as HTMLSelectElement;
    expect(select.value).toBe('b');
    expect(select.hasAttribute('data-who')).toBe(true);
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(select.getAttribute('aria-describedby')!.split(' ')).toHaveLength(2);
    expect(screen.getByRole('alert').textContent).toBe('Pick someone');
    fireEvent.change(select, { target: { value: 'a' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('FilePick', () => {
  it('says "Choose the file", then shows the name as a chip with Remove', () => {
    inText(<FilePick label="The file" accept=".csv" />);
    const input = screen.getByLabelText('The file') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(screen.getByText('Choose the file').closest('label')).not.toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.change(input, { target: { files: [aFile('bank.csv')] } });
    const chip = screen.getByText('bank.csv').closest('[data-file-chip]') as HTMLElement;
    expect(within(chip).getByRole('button', { name: 'Remove bank.csv' })).toBeTruthy();
  });

  it('Remove forgets the file and tells the form, through the same change', () => {
    const seen: (string | null)[] = [];
    inText(<FilePick label="The file" onChange={(event) => seen.push(event.currentTarget.files?.[0]?.name ?? null)} />);
    const input = screen.getByLabelText('The file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [aFile('a.csv')] } });
    Object.defineProperty(input, 'files', { configurable: true, value: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.csv' }));
    expect(screen.queryByText('a.csv')).toBeNull();
    expect(seen).toEqual(['a.csv', null]);
  });

  it('with its files given, the form holds them: one Remove per file', () => {
    function Form() {
      const [files, setFiles] = useState([aFile('one.pdf'), aFile('two.pdf')]);
      return <FilePick label="Files" multiple files={files} onRemove={(index) => setFiles(files.filter((_, i) => i !== index))} />;
    }
    inText(<Form />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove one.pdf' }));
    expect(screen.queryByText('one.pdf')).toBeNull();
    expect(screen.getByText('two.pdf')).toBeTruthy();
  });

  it('compact draws the icon alone, the words for readers and a title', () => {
    const { container } = inText(<FilePick compact icon="paperclip" choose="Attach a file" files={[]} />);
    const pick = container.querySelector('label')!;
    expect(pick.getAttribute('title')).toBe('Attach a file');
    expect(pick.querySelector('.sr-only')!.textContent).toBe('Attach a file');
    expect(screen.getByLabelText('Attach a file')).toBeTruthy();
  });

  it('takes the keyboard ring of the input it names, and looks disabled when it is', () => {
    expect(rule('FilePick.module.css', '.native:focus-visible + .choose')).toContain('outline: var(--focus) solid var(--link)');
    expect(rule('FilePick.module.css', '.native:disabled + .choose')).toContain('var(--mute)');
  });
});

describe('OptionRows', () => {
  const options = [
    { id: 'new', label: 'Start a new business' },
    { id: 'add', label: 'Add this to Bookkeeping studio', detail: 'It changes the plan' },
  ];

  it('is a radiogroup named by its legend, and a press answers with the id', () => {
    const onChange = vi.fn();
    inText(<OptionRows legend="Where" value="new" options={options} onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Where' });
    expect((within(group).getByRole('radio', { name: 'Start a new business' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(group).getByRole('radio', { name: /Add this to/ }));
    expect(onChange).toHaveBeenCalledWith('add');
  });

  it('a detail sits on its own line under the words', () => {
    inText(<OptionRows legend="Where" value="new" options={options} onChange={() => {}} />);
    expect(rule('OptionRows.module.css', '.detail')).toContain('display: block');
    expect(screen.getByText('It changes the plan').previousElementSibling!.textContent).toBe('Add this to Bookkeeping studio');
  });

  it('has no chip look: no border, no fill, plain rows', () => {
    const row = rule('OptionRows.module.css', '.row');
    expect(row).not.toContain('border');
    expect(row).not.toContain('background');
    expect(row).toContain('min-height');
  });

  it('can stop being pressed, and passes attributes through', () => {
    const { container } = inText(<OptionRows legend="Where" value="new" options={options} onChange={() => {}} disabled data-business-pick="" />);
    expect(screen.getByRole('radiogroup').hasAttribute('disabled')).toBe(true);
    expect(container.querySelector('[data-business-pick]')).not.toBeNull();
  });
});

describe('CheckRow', () => {
  it('holds the name and its detail on two lines, both naming the checkbox', () => {
    const onChange = vi.fn();
    inText(<CheckRow label="Usage reports" detail="Counts, steps and timings" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: /Usage reports/ });
    expect(screen.getByText('Counts, steps and timings').previousElementSibling!.textContent).toBe('Usage reports');
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
