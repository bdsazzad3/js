import type { Team } from "@/api/team";
import { PricingCard } from "components/homepage/sections/PricingCard";
import { useMemo } from "react";
import { getValidTeamPlan } from "../../../../app/team/components/TeamHeader/getValidTeamPlan";

// TODO - move this in app router folder in other pr

interface BillingPricingProps {
  team: Team;
  trialPeriodEndedAt: string | undefined;
}

type CtaLink = {
  label: string;
};

export const BillingPricing: React.FC<BillingPricingProps> = ({
  team,
  trialPeriodEndedAt,
}) => {
  const validTeamPlan = getValidTeamPlan(team);
  const contactUsHref = "/contact-us";

  const starterCta: CtaLink | undefined = useMemo(() => {
    switch (validTeamPlan) {
      // free > starter
      case "free": {
        return {
          label: "Get started for free",
        };
      }

      // starter > starter
      case "starter": {
        return undefined;
      }

      // growth > starter
      case "growth": {
        return {
          label: "Downgrade",
        };
      }

      // pro > starter
      case "pro": {
        return {
          label: "Contact us",
          target: "_blank",
        };
      }
    }
  }, [validTeamPlan]);

  const growthCardCta: CtaLink | undefined = useMemo(() => {
    const trialTitle = "Claim your 1-month free";

    switch (validTeamPlan) {
      // free > growth
      case "free": {
        return {
          label: team.growthTrialEligible ? trialTitle : "Get started",
        };
      }

      // starter > growth
      case "starter": {
        return {
          label: team.growthTrialEligible ? trialTitle : "Upgrade",
        };
      }

      // growth > growth
      case "growth": {
        return undefined;
      }

      // pro > growth
      case "pro": {
        return {
          label: "Contact us",
          target: "_blank",
        };
      }
    }
  }, [team, validTeamPlan]);

  const proCta: CtaLink | undefined = useMemo(() => {
    // pro > pro
    if (validTeamPlan === "pro") {
      return undefined;
    }

    // others
    return {
      label: "Contact us",
      href: contactUsHref,
    };
  }, [validTeamPlan]);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      {/* Starter */}
      <PricingCard
        billingPlan="starter"
        current={validTeamPlan === "starter"}
        cta={
          starterCta
            ? {
                title: starterCta.label,
                tracking: {
                  category: "account",
                  label: "starterPlan",
                },
              }
            : undefined
        }
        teamSlug={team.slug}
      />

      {/* Growth */}
      <PricingCard
        billingPlan="growth"
        activeTrialEndsAt={
          validTeamPlan === "growth" ? trialPeriodEndedAt : undefined
        }
        current={validTeamPlan === "growth"}
        cta={
          growthCardCta
            ? {
                title: growthCardCta.label,
                tracking: {
                  category: "account",
                  label: team.growthTrialEligible
                    ? "claimGrowthTrial"
                    : "growthPlan",
                },
                variant: "default",
                hint: team.growthTrialEligible
                  ? "Your free trial will end after 30 days."
                  : undefined,
              }
            : undefined
        }
        canTrialGrowth={team.growthTrialEligible || false}
        // upsell growth plan if user is on free plan
        highlighted={validTeamPlan === "free"}
        teamSlug={team.slug}
      />

      <PricingCard
        billingPlan="pro"
        teamSlug={team.slug}
        current={validTeamPlan === "pro"}
        cta={
          proCta
            ? {
                title: proCta.label,
                tracking: {
                  category: "account",
                  label: "proPlan",
                },
              }
            : undefined
        }
      />
    </div>
  );
};
