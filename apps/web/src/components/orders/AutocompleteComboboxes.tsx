import { useState } from "react";
import { Combobox } from "../ui/combobox";
import { useClientAutocomplete, useMediaAutocomplete } from "@/hooks/useAutocomplete";
import { useDebounce } from "@/hooks/use-debounce";

export function ClientCombobox({ value, onChange, className, id }: { value: string; onChange: (v: string) => void; className?: string; id?: string }) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const { data: options = [], isLoading } = useClientAutocomplete(debouncedSearch);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      onSearch={setSearch}
      isLoading={isLoading}
      placeholder="e.g. Acme Corp"
      emptyText="No clients found."
      className={className}
    />
  );
}

export function MediaCombobox({ value, onChange, className, id }: { value: string; onChange: (v: string) => void; className?: string; id?: string }) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const { data: options = [], isLoading } = useMediaAutocomplete(debouncedSearch);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      onSearch={setSearch}
      isLoading={isLoading}
      placeholder="e.g. Vinyl"
      emptyText="No media found."
      className={className}
    />
  );
}
