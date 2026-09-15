'use client';
import { photoSource } from './photo-source';
/* eslint-disable @next/next/no-img-element */
import { useCallback, useState } from 'react';
import type { Ref } from 'react';
import { leadershipPhotoStyle, photoCoordinates } from './leadership-photo';
import type { LeadershipPerson } from './leadership-types';
type Props = { photo: Pick<LeadershipPerson, 'photoUrl' | 'photoPosition' | 'photoScale'>; alt: string; aspectRatio: number; className: string; imageRef?: Ref<HTMLImageElement> };
export default function PositionedPhoto({ photo, alt, aspectRatio, className, imageRef }: Props) {
  const [loaded, setLoaded] = useState({ src: '', ratio: 0 });
  const photoUrl = photo.photoUrl;
  const imageUrl = photoSource(photoUrl);
  const attachImage = useCallback((image: HTMLImageElement | null) => {
    if (typeof imageRef === 'function') imageRef(image);
    else if (imageRef) {
      // eslint-disable-next-line react-hooks/immutability -- React calls this ref callback during commit; forwarding the DOM node is the intended ref contract.
      imageRef.current = image;
    }
    if (image?.complete && image.naturalWidth) {
      const ratio = image.naturalWidth / image.naturalHeight;
      setLoaded((current) => current.src === photoUrl && current.ratio === ratio ? current : { src: photoUrl, ratio });
    }
  }, [imageRef, photoUrl]);
  const ratio = loaded.src === photo.photoUrl ? loaded.ratio : 0;
  const position = photoCoordinates(photo.photoPosition);
  const scale = photo.photoScale;
  const imageStyle = ratio ? {
    width: `${Math.max(100, ratio / aspectRatio * 100) * scale}%`,
    height: `${Math.max(100, aspectRatio / ratio * 100) * scale}%`,
    left: `${position.x}%`, top: `${position.y}%`,
    transform: `translate(${-position.x}%, ${-position.y}%)`,
  } : leadershipPhotoStyle(photo);
  return <img ref={attachImage} className={className} src={imageUrl} alt={alt} draggable={false} style={imageStyle} onLoad={(event) => setLoaded({ src: photoUrl, ratio: event.currentTarget.naturalWidth / event.currentTarget.naturalHeight })} />;
}
