import useEmblaCarousel from 'embla-carousel-react';
import { useCallback } from 'react';

function TestComponent() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext();
  }, [emblaApi]);

  const slides = ['Slide 1', 'Slide 2', 'Slide 3', 'Slide 4'];

  return (
    <div>
      <div ref={emblaRef} style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex' }}>
          {slides.map((text, i) => (
            <div
              key={i}
              style={{
                flex: '0 0 100%',
                minWidth: 0,
                padding: '16px',
                textAlign: 'center',
                background: i % 2 === 0 ? '#1e293b' : '#334155',
                borderRadius: '4px',
              }}
            >
              {text}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button
          onclick={scrollPrev}
          style={{ padding: '4px 10px', cursor: 'pointer', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
        >
          Prev
        </button>
        <button
          onclick={scrollNext}
          style={{ padding: '4px 10px', cursor: 'pointer', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

TestComponent.packageName = 'embla-carousel-react';
TestComponent.downloads = '6.5M/week';
export default TestComponent;
