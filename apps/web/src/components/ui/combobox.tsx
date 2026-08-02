import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
  onSearch?: (search: string) => void;
  isLoading?: boolean;
  id?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select...",
  emptyText = "No results found.",
  className,
  onSearch,
  isLoading,
  id,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    if (onSearch) {
      onSearch(search);
    }
  }, [search, onSearch]);

  const handleSelect = (currentValue: string) => {
    onChange(currentValue);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && search) {
      handleSelect(search);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate block flex-1 text-left">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full min-w-[200px] p-0" align="start">
        <Command shouldFilter={!onSearch}>
          <CommandInput 
            placeholder="Search..." 
            value={search}
            onValueChange={setSearch}
            onKeyDown={handleKeyDown}
          />
          <CommandList>
            {isLoading && <CommandEmpty>Loading...</CommandEmpty>}
            {!isLoading && <CommandEmpty>{search ? `Press enter to use "${search}"` : emptyText}</CommandEmpty>}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={handleSelect}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option}
                </CommandItem>
              ))}
              {search && !options.includes(search) && (
                <CommandItem value={search} onSelect={handleSelect}>
                  <Check className="mr-2 h-4 w-4 opacity-0" />
                  Use "{search}"
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
