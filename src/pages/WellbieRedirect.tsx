import { useEffect } from "react";
import { Navigate } from "react-router-dom";

export default function WellbieRedirect() {
  useEffect(() => {
    window.dispatchEvent(new Event("openWellbieChat"));
  }, []);

  return <Navigate to="/dashboard" replace />;
}
