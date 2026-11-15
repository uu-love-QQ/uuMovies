import React, { useState, useEffect, useRef } from 'react';
import { Film } from 'lucide-react';
import { cn } from '../../lib/utils';

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string;
  alt?: string;
  className?: string;
  fallbackIcon?: React.ReactNode;
}

export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt = '',
  className,
  fallbackIcon,
  ...props
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);

    if (!src) {
      setHasError(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, [src]);

  return (
    <div
      ref={imgRef}
      className={cn(
        'relative w-full h-full overflow-hidden bg-secondary',
        className
      )}
    >
      {/* Pulse skeleton placeholder - theme adaptive, never flashes white */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 bg-muted/80 animate-pulse flex items-center justify-center">
          <Film className="w-5 h-5 text-muted-foreground/30" />
        </div>
      )}

      {/* Fallback error */}
      {hasError ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground bg-muted/40">
          {fallbackIcon || <Film className="w-6 h-6 mb-1 opacity-40" />}
          <span className="text-[10px] opacity-60">暂无海报</span>
        </div>
      ) : (
        isVisible &&
        src && (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={() => setIsLoaded(true)}
            onError={() => setHasError(true)}
            className={cn(
              'w-full h-full object-cover transition-opacity duration-300',
              isLoaded ? 'opacity-100' : 'opacity-0'
            )}
            {...props}
          />
        )
      )}
    </div>
  );
};
