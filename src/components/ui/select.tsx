"use client";

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

type OptionChild = React.ReactElement<React.OptionHTMLAttributes<HTMLOptionElement>>;

export interface SelectProps {
  children?: React.ReactNode;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  required?: boolean;
  value?: string;
}

interface ParsedOption {
  disabled?: boolean;
  internalValue: string;
  label: React.ReactNode;
  value: string;
}

const EMPTY_OPTION_VALUE = '__tnymaai_select_empty__';

function parseOptionChildren(children: React.ReactNode) {
  const options: ParsedOption[] = [];
  let placeholder: React.ReactNode | undefined;

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || child.type !== 'option') {
      return;
    }

    const option = child as OptionChild;
    const value = option.props.value == null ? '' : String(option.props.value);

    if (value === '') {
      placeholder = option.props.children;
      if (!option.props.disabled) {
        options.push({
          value: '',
          internalValue: EMPTY_OPTION_VALUE,
          label: option.props.children,
          disabled: false,
        });
      }
      return;
    }

    options.push({
      value,
      internalValue: value,
      label: option.props.children,
      disabled: option.props.disabled,
    });
  });

  return { options, placeholder };
}

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  ({ className, children, defaultValue, disabled, id, name, onChange, required, value }, ref) => {
    const { options, placeholder } = React.useMemo(() => parseOptionChildren(children), [children]);
    const controlledValue = value?.trim() ? value : undefined;
    const uncontrolledValue = defaultValue?.trim() ? defaultValue : undefined;
    const radixValue = controlledValue === undefined ? undefined : (controlledValue || EMPTY_OPTION_VALUE);
    const radixDefaultValue = uncontrolledValue === undefined ? undefined : (uncontrolledValue || EMPTY_OPTION_VALUE);

    const normalizedOptions = React.useMemo(() => {
      if (controlledValue && !options.some((option) => option.value === controlledValue)) {
        return [...options, { value: controlledValue, internalValue: controlledValue, label: controlledValue }];
      }
      return options;
    }, [controlledValue, options]);

    const handleValueChange = React.useCallback((nextValue: string) => {
      if (!onChange) {
        return;
      }

      const resolvedValue = nextValue === EMPTY_OPTION_VALUE ? '' : nextValue;

      const syntheticEvent = {
        target: { value: resolvedValue, name, id },
        currentTarget: { value: resolvedValue, name, id },
      } as React.ChangeEvent<HTMLSelectElement>;

      onChange(syntheticEvent);
    }, [id, name, onChange]);

    return (
      <>
        {name ? (
          <input
            type="hidden"
            name={name}
            value={controlledValue ?? uncontrolledValue ?? ''}
            required={required}
            disabled={disabled}
          />
        ) : null}
        <SelectPrimitive.Root
          value={radixValue}
          defaultValue={radixValue ? undefined : radixDefaultValue}
          onValueChange={handleValueChange}
          disabled={disabled}
        >
          <SelectPrimitive.Trigger
            ref={ref}
            id={id}
            className={cn(
              'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
            aria-required={required}
          >
            <SelectPrimitive.Value placeholder={placeholder} />
            <SelectPrimitive.Icon asChild>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              position="popper"
              sideOffset={6}
              className="z-50 w-[var(--radix-select-trigger-width)] min-w-[12rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
            >
              <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center bg-popover text-muted-foreground">
                <ChevronUp className="h-4 w-4" />
              </SelectPrimitive.ScrollUpButton>
              <SelectPrimitive.Viewport className="max-h-64 overflow-y-auto p-1">
                {normalizedOptions.map((option) => (
                  <SelectPrimitive.Item
                    key={option.internalValue}
                    value={option.internalValue}
                    disabled={option.disabled}
                    className="relative flex w-full cursor-default select-none items-center rounded-sm py-2 pl-8 pr-3 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex h-4 w-4 items-center justify-center">
                      <Check className="h-4 w-4" />
                    </SelectPrimitive.ItemIndicator>
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
              <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center bg-popover text-muted-foreground">
                <ChevronUp className="h-4 w-4 rotate-180" />
              </SelectPrimitive.ScrollDownButton>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
      </>
    );
  }
);

Select.displayName = 'Select';

export { Select };
