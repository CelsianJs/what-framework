import { useState, useCallback } from 'react';
import useEmblaCarousel from 'embla-carousel-react';

const slides = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];

export function EmblaTest() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });
  const [current, setCurrent] = useState(0);

  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => {
    if (emblaApi) {
      emblaApi.scrollNext();
      setCurrent(emblaApi.selectedScrollSnap());
    }
  }, [emblaApi]);

  return (
    <div>
      <div ref={emblaRef} style={{ overflow: 'hidden', borderRadius: '8px' }}>
        <div style={{ display: 'flex' }}>
          {slides.map((bg, i) => (
            <div key={i} style={{
              flex: '0 0 100%', minWidth: 0,
              height: '120px', background: bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: '24px', fontWeight: 'bold'
            }}>
              Slide {i + 1}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button onclick={scrollPrev}>Prev</button>
        <button onclick={scrollNext}>Next</button>
      </div>
      <p style={{ color: 'green', marginTop: '4px' }}>embla-carousel-react with loop + 5 slides</p>
    </div>
  );
}
