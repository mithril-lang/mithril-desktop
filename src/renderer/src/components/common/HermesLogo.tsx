import icon from "@mithril/design-system/mithril-mark.svg";

function HermesLogo({ size = 32 }: { size?: number }): React.JSX.Element {
  return (
    <img
      src={icon}
      width={size}
      height={size}
      className="rounded-xl"
      alt="Mithril"
    />
  );
}

export default HermesLogo;
