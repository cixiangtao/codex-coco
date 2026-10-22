import { HexColorPicker } from "react-colorful";

interface ColorPickerProps {
  /** Opaque six-digit HEX. The caller owns draft validation and persistence. */
  value: string;
  onValueChange(value: string): void;
  label: string;
  disabled?: boolean;
}

/** Controlled color surface; emits while dragging or using arrow keys, without saving. */
export function ColorPicker({ value, onValueChange, label, disabled = false }: ColorPickerProps) {
  return (
    <fieldset
      className="coco-color-picker"
      aria-label={label}
      disabled={disabled}
      data-disabled={disabled}
      inert={disabled}
    >
      <HexColorPicker
        color={value}
        onChange={(next) => {
          if (!disabled) onValueChange(next);
        }}
      />
    </fieldset>
  );
}
