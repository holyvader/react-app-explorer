export interface ButtonProps {
  label: string;
  onClick?: () => void;
  variant?: "primary" | "ghost";
}

export const Button = ({ label, onClick, variant = "primary" }: ButtonProps) => (
  <button className={variant} onClick={onClick}>
    {label}
  </button>
);
