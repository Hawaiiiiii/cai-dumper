import { useCallback } from "react";
import Particles from "react-tsparticles";
import { loadSnowPreset } from "tsparticles-preset-snow";
import { Engine } from "tsparticles-engine";

interface SnowOverlayProps {
    enabled: boolean;
}

export default function SnowOverlay({ enabled }: SnowOverlayProps) {
    const particlesInit = useCallback(async (engine: Engine) => {
        await loadSnowPreset(engine);
    }, []);

    if (!enabled) return null;

    return (
        <Particles
            id="tsparticles"
            init={particlesInit}
            options={{
                preset: "snow",
                fullScreen: { 
                    enable: true, 
                    zIndex: 9999 
                },
                background: {
                    color: {
                        value: "transparent",
                    },
                },
                particles: {
                    move: {
                        enable: true,
                        speed: 1.5, // default
                        direction: "bottom",
                        straight: false,
                    },
                    opacity: {
                        value: 0.7,
                    },
                    size: {
                        value: { min: 1, max: 3 }, // 1-3px size
                    },
                    number: {
                        value: 60, // Not too crowded
                        density: {
                            enable: true,
                            area: 800,
                        },
                    },
                },
            }}
            className="pointer-events-none fixed inset-0 z-[9999]"
        />
    );
}
