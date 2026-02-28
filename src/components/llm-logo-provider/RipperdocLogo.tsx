import React from 'react';

type RipperdocLogoProps = {
  className?: string;
};

const RipperdocLogo = ({ className = 'w-5 h-5' }: RipperdocLogoProps) => {
  return <img src="/icons/ripperdoc.svg" alt="Ripperdoc" className={className} />;
};

export default RipperdocLogo;
