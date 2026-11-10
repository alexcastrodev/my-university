import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialog } from './confirm-dialog';

function setup() {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(ConfirmDialog);
  fixture.componentRef.setInput('heading', 'Remove it?');
  fixture.componentRef.setInput('message', 'This cannot be undone.');
  fixture.componentRef.setInput('confirmLabel', 'Remove');
  fixture.componentRef.setInput('cancelLabel', 'Cancel');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const dialog = el.querySelector('dialog') as HTMLDialogElement;
  const confirmed = jasmine.createSpy('confirmed');
  const cancelled = jasmine.createSpy('cancelled');
  fixture.componentInstance.confirmed.subscribe(confirmed);
  fixture.componentInstance.cancelled.subscribe(cancelled);
  const setOpen = (open: boolean) => { fixture.componentRef.setInput('open', open); fixture.detectChanges(); };
  return { el, dialog, confirmed, cancelled, setOpen };
}

describe('ConfirmDialog', () => {
  it('stays closed until `open` is true, and closes when it goes back to false', () => {
    const { dialog, setOpen } = setup();
    expect(dialog.open).toBe(false);
    setOpen(true);
    expect(dialog.open).toBe(true);
    setOpen(false);
    expect(dialog.open).toBe(false);
  });

  it('shows the question and the button labels', () => {
    const { el } = setup();
    expect(el.textContent).toContain('Remove it?');
    expect(el.textContent).toContain('This cannot be undone.');
    expect(el.querySelector('[data-testid="confirm-dialog-confirm"]')!.textContent).toContain('Remove');
    expect(el.querySelector('[data-testid="confirm-dialog-cancel"]')!.textContent).toContain('Cancel');
  });

  it('emits `confirmed` from the confirm button and `cancelled` from the cancel button', () => {
    const { el, confirmed, cancelled, setOpen } = setup();
    setOpen(true);
    (el.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement).click();
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
    (el.querySelector('[data-testid="confirm-dialog-cancel"]') as HTMLButtonElement).click();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('turns Escape into `cancelled` and leaves closing to the parent', () => {
    const { dialog, cancelled, setOpen } = setup();
    setOpen(true);
    const event = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(event);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
  });
});
