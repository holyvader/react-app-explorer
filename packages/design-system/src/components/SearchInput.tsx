import { Input, InputGroup, type InputProps } from "@chakra-ui/react";
import { Search } from "lucide-react";
import { forwardRef } from "react";

export interface SearchInputProps extends Omit<InputProps, "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onValueChange, ...rest },
  ref,
) {
  return (
    <InputGroup startElement={<Search size={16} />}>
      <Input ref={ref} value={value} onChange={(e) => onValueChange(e.target.value)} {...rest} />
    </InputGroup>
  );
});
