import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '../../src/parts/Button';
import { Change } from '../../src/parts/Change';
import { Receipt } from '../../src/parts/Receipt';
import { ModelEstimate } from '../../src/parts/ModelEstimate';
import { EmptyState } from '../../src/parts/EmptyState';
import { Field } from '../../src/parts/Field';
import { TextProvider } from '../../src/text';

describe('Button', () => {
  it('is a real button that never submits a form, in one of three looks', () => {
    const onClick = vi.fn();
    render(<><Button variant="primary" onClick={onClick}>Approve</Button><Button>Deny</Button><Button variant="quiet">Close</Button></>);
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve.getAttribute('type')).toBe('button');
    expect(approve.dataset.variant).toBe('primary');
    expect(screen.getByRole('button', { name: 'Deny' }).dataset.variant).toBe('secondary');
    fireEvent.click(approve);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('Change', () => {
  it('strikes the old value, shows the new one in mono and links its receipt', () => {
    const onReceipt = vi.fn();
    const { container } = render(<Change before="₹25,000" after="₹30,000" receiptId="R-0415" onReceipt={onReceipt} />);
    const old = container.querySelector('del')!;
    expect(old.textContent).toBe('₹25,000');
    expect(old.className).toContain('mono');
    expect(screen.getByText('₹30,000').className).toContain('mono');
    expect(container.textContent).toContain('was');
    fireEvent.click(screen.getByRole('button', { name: 'Receipt R-0415' }));
    expect(onReceipt).toHaveBeenCalledWith('R-0415');
  });

  it('a model estimate never carries a receipt, even when one is sent', () => {
    render(<Change after="18,000" receiptId="R-9999" estimate />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('model estimate')).toBeTruthy();
  });
});

describe('Receipt', () => {
  it('is a button that opens the receipt sheet, labelled with its id, never a bare amount', () => {
    render(<Receipt id="R-0419" />);
    const button = screen.getByRole('button', { name: 'Receipt R-0419' });
    expect(button.textContent).toBe('R-0419');
    fireEvent.click(button);
    expect(window.location.hash).toBe('#/today?sheet=receipt%3AR-0419');
  });
});

describe('ModelEstimate', () => {
  it('puts the words "model estimate" beside a model-written number and offers no receipt', () => {
    const { container } = render(<ModelEstimate value="About 18,000 views" />);
    expect(container.textContent).toBe('About 18,000 views model estimate');
    expect(container.querySelector('button')).toBeNull();
  });
  it('in Hindi too', () => {
    const { container } = render(<TextProvider language="hi"><ModelEstimate /></TextProvider>);
    expect(container.textContent).toBe('मॉडल का अनुमान');
  });
});

describe('EmptyState', () => {
  it('says it plainly', () => {
    render(<EmptyState title="Nothing needs you." />);
    expect(screen.getByText('Nothing needs you.')).toBeTruthy();
  });
});

describe('Field', () => {
  it('labels its input and describes it with the hint and the error', () => {
    render(<Field label="Your answer" hint="One line is enough." error="Write an answer first." value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Your answer');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(['One line is enough.', 'Write an answer first.']);
  });
  it('can be several lines', () => {
    render(<Field label="Note" multiline value="a" onChange={() => {}} />);
    expect(screen.getByLabelText('Note').tagName).toBe('TEXTAREA');
  });
});
