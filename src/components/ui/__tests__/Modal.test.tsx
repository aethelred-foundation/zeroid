import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Modal, ModalFooter, ConfirmDialog } from '@/components/ui/Modal';

// Mock @headlessui/react with functional Dialog
jest.mock('@headlessui/react', () => {
  const Dialog = ({ children, onClose, ...props }: React.PropsWithChildren<{ onClose: () => void; as?: string; className?: string }>) => {
    return (
      <div data-testid="dialog" role="dialog" {...props}>
        {children}
      </div>
    );
  };
  Dialog.Panel = ({ children, className }: React.PropsWithChildren<{ className?: string }>) => (
    <div data-testid="dialog-panel" className={className}>{children}</div>
  );
  Dialog.Title = ({ children, className }: React.PropsWithChildren<{ className?: string }>) => (
    <h2 data-testid="dialog-title" className={className}>{children}</h2>
  );
  Dialog.Description = ({ children, className }: React.PropsWithChildren<{ className?: string }>) => (
    <p data-testid="dialog-description" className={className}>{children}</p>
  );

  const Transition = ({ children, show }: React.PropsWithChildren<{ show?: boolean; as?: React.ElementType; appear?: boolean }>) => {
    if (show === false) return null;
    return <>{children}</>;
  };
  Transition.Child = ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <>{children}</>;

  return { Dialog, Transition, Fragment: React.Fragment };
});

// Mock lucide-react
jest.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="icon-x" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="icon-alert" {...props} />,
}));

describe('Modal', () => {
  it('renders when open is true', () => {
    render(
      <Modal open={true} onClose={jest.fn()}>
        <div>Modal Content</div>
      </Modal>
    );
    expect(screen.getByText('Modal Content')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(
      <Modal open={false} onClose={jest.fn()}>
        <div>Modal Content</div>
      </Modal>
    );
    expect(screen.queryByText('Modal Content')).not.toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <Modal open={true} onClose={jest.fn()} title="Test Title">
        <div>Content</div>
      </Modal>
    );
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <Modal open={true} onClose={jest.fn()} title="Title" description="Test Description">
        <div>Content</div>
      </Modal>
    );
    expect(screen.getByText('Test Description')).toBeInTheDocument();
  });

  it('renders close button by default', () => {
    const onClose = jest.fn();
    render(
      <Modal open={true} onClose={onClose} title="Title">
        <div>Content</div>
      </Modal>
    );
    const closeButton = screen.getByLabelText('Close');
    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides close button when showClose is false', () => {
    render(
      <Modal open={true} onClose={jest.fn()} showClose={false}>
        <div>Content</div>
      </Modal>
    );
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });

  it('applies size class', () => {
    render(
      <Modal open={true} onClose={jest.fn()} size="lg">
        <div>Content</div>
      </Modal>
    );
    const panel = screen.getByTestId('dialog-panel');
    expect(panel.className).toContain('max-w-2xl');
  });

  it('defaults to md size', () => {
    render(
      <Modal open={true} onClose={jest.fn()}>
        <div>Content</div>
      </Modal>
    );
    const panel = screen.getByTestId('dialog-panel');
    expect(panel.className).toContain('max-w-lg');
  });

  it('applies sm size', () => {
    render(
      <Modal open={true} onClose={jest.fn()} size="sm">
        <div>Content</div>
      </Modal>
    );
    const panel = screen.getByTestId('dialog-panel');
    expect(panel.className).toContain('max-w-md');
  });

  it('applies xl size', () => {
    render(
      <Modal open={true} onClose={jest.fn()} size="xl">
        <div>Content</div>
      </Modal>
    );
    const panel = screen.getByTestId('dialog-panel');
    expect(panel.className).toContain('max-w-4xl');
  });

  it('applies full size', () => {
    render(
      <Modal open={true} onClose={jest.fn()} size="full">
        <div>Content</div>
      </Modal>
    );
    const panel = screen.getByTestId('dialog-panel');
    expect(panel.className).toContain('max-w-[90vw]');
  });

  it('applies custom className', () => {
    render(
      <Modal open={true} onClose={jest.fn()} className="custom-modal">
        <div>Content</div>
      </Modal>
    );
    const panel = screen.getByTestId('dialog-panel');
    expect(panel.className).toContain('custom-modal');
  });

  it('does not render header when no title and showClose is false', () => {
    render(
      <Modal open={true} onClose={jest.fn()} showClose={false}>
        <div>Content</div>
      </Modal>
    );
    expect(screen.queryByTestId('dialog-title')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });
});

describe('ModalFooter', () => {
  it('renders children', () => {
    render(
      <ModalFooter>
        <button>Save</button>
        <button>Cancel</button>
      </ModalFooter>
    );
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <ModalFooter className="extra-class">
        <button>OK</button>
      </ModalFooter>
    );
    const footer = container.firstChild as HTMLElement;
    expect(footer.className).toContain('extra-class');
    expect(footer.className).toContain('border-t');
  });
});

describe('ConfirmDialog', () => {
  it('renders title and description', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Confirm Delete"
        description="This action cannot be undone."
      />
    );
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
  });

  it('renders default button labels', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Confirm"
      />
    );
    // "Confirm" appears as both the title and the confirm button
    const confirmElements = screen.getAllByText('Confirm');
    expect(confirmElements.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('renders custom button labels', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Delete?"
        confirmLabel="Yes, Delete"
        cancelLabel="No, Keep"
      />
    );
    expect(screen.getByText('Yes, Delete')).toBeInTheDocument();
    expect(screen.getByText('No, Keep')).toBeInTheDocument();
  });

  it('calls onConfirm and onClose when confirm is clicked', () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    render(
      <ConfirmDialog
        open={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Confirm"
        confirmLabel="Do it"
      />
    );
    fireEvent.click(screen.getByText('Do it'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when cancel is clicked', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    render(
      <ConfirmDialog
        open={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Confirm"
      />
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows loading text when loading', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Confirm"
        loading={true}
      />
    );
    expect(screen.getByText('Processing...')).toBeInTheDocument();
  });

  it('disables buttons when loading', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Confirm"
        loading={true}
      />
    );
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('renders danger variant styling', () => {
    const { container } = render(
      <ConfirmDialog
        open={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Delete"
        variant="danger"
      />
    );
    // The confirm button should have red styling
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('bg-red-500');
  });

  it('renders default variant styling', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Confirm"
        variant="default"
      />
    );
    const confirmBtns = screen.getAllByText('Confirm');
    // Find the button element (not the title heading)
    const confirmBtn = confirmBtns.find((el) => el.tagName === 'BUTTON')!;
    expect(confirmBtn.className).toContain('bg-gradient-to-r');
  });

  it('does not render when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Hidden"
      />
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="No description"
      />
    );
    // Only the title h3 should exist, no description p
    const title = screen.getByText('No description');
    expect(title.tagName).toBe('H3');
  });
});
