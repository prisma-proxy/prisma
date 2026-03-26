interface QrDisplayProps {
  svg: string;
}

export default function QrDisplay({ svg }: QrDisplayProps) {
  return (
    <div
      className="flex items-center justify-center p-4 bg-white rounded-lg"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
