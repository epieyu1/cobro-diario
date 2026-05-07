import { useState } from 'react'

export interface SearchableSelectOption {
  value: string
  label: string
  sublabel?: string
}

interface SearchableSelectProps {
  className?: string
  emptyLabel?: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  value: string
}

export function SearchableSelect({
  className = '',
  emptyLabel = 'Sin resultados',
  onChange,
  options,
  placeholder = 'Seleccionar...',
  searchPlaceholder = 'Buscar...',
  value,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const selectedOption = options.find((option) => option.value === value) ?? null
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const filteredOptions = normalizedSearchTerm
    ? options.filter((option) => {
        const haystack = [option.label, option.sublabel]
          .filter((part): part is string => Boolean(part))
          .join(' ')
          .toLowerCase()

        return haystack.includes(normalizedSearchTerm)
      })
    : options

  function handleClose() {
    setIsOpen(false)
    setSearchTerm('')
  }

  function handleToggle() {
    if (isOpen) {
      handleClose()
      return
    }

    setIsOpen(true)
  }

  function handleSelect(optionValue: string) {
    onChange(optionValue)
    handleClose()
  }

  return (
    <div
      className={`searchable-select ${className}`.trim()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          handleClose()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          handleClose()
        }
      }}
    >
      <button
        type="button"
        className={`searchable-select-trigger ${isOpen ? 'open' : ''}`}
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <div className="searchable-select-copy">
          <strong>{selectedOption?.label ?? placeholder}</strong>
          {selectedOption?.sublabel && <span className="muted-copy compact">{selectedOption.sublabel}</span>}
        </div>
        <span className="searchable-select-chevron" aria-hidden="true">▾</span>
      </button>

      {isOpen && (
        <div className="searchable-select-dropdown" role="listbox">
          <input
            className="input"
            autoFocus
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />

          <div className="searchable-select-options">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={`searchable-select-option ${option.value === value ? 'selected' : ''}`}
                  onClick={() => handleSelect(option.value)}
                >
                  <strong>{option.label}</strong>
                  {option.sublabel && <span className="muted-copy compact">{option.sublabel}</span>}
                </button>
              ))
            ) : (
              <div className="muted-copy compact searchable-select-empty">{emptyLabel}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
