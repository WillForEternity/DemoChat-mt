import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
        // Neumorphic variants - uses CSS classes for the soft UI effect
        // Buttons match their container background for proper neumorphic illusion
        neumorphic: '',
        'neumorphic-primary': '',
        'neumorphic-secondary': '',
        'neumorphic-destructive': '',
        'neumorphic-success': '',
        'neumorphic-round': '',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

// Check if variant is a neumorphic type
function isNeumorphicVariant(variant: string | null | undefined): boolean {
  return variant?.startsWith('neumorphic') ?? false
}

// Get the neumorphic color class based on variant
function getNeumorphicColorClass(variant: string | null | undefined): string {
  switch (variant) {
    case 'neumorphic-primary':
      return 'neu-primary'
    case 'neumorphic-secondary':
      return 'neu-secondary'
    case 'neumorphic-destructive':
      return 'neu-destructive'
    case 'neumorphic-success':
      return 'neu-success'
    default:
      return ''
  }
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'
  
  // Handle neumorphic variants with special structure
  if (isNeumorphicVariant(variant)) {
    const isRound = variant === 'neumorphic-round'
    const colorClass = getNeumorphicColorClass(variant)
    
    if (isRound) {
      return (
        <Comp
          data-slot="button"
          className={cn(
            'neu-tile neu-round-button',
            buttonVariants({ variant: null, size, className }),
            className
          )}
          {...props}
        >
          <span className="neu-content">{children}</span>
        </Comp>
      )
    }
    
    return (
      <Comp
        data-slot="button"
        className={cn(
          'neu-tile neu-button',
          colorClass,
          buttonVariants({ variant: null, size, className }),
          className
        )}
        {...props}
      >
        <div className="neu-inner">
          <span className="neu-content">{children}</span>
        </div>
      </Comp>
    )
  }

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </Comp>
  )
}

export { Button, buttonVariants }
