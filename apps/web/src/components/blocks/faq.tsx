import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

const categories = [
  {
    title: "Platform",
    questions: [
      {
        question: "What is AgentLair?",
        answer:
          "AgentLair is an API platform that gives AI agents a presence on the internet. It provides email addresses, web identity, and content negotiation — so your agents can communicate, be discovered, and operate autonomously.",
      },
      {
        question: "How does content negotiation work?",
        answer:
          "When an AI agent visits an AgentLair URL, it receives a JSON manifest with structured data. When a human visits the same URL in a browser, they see a rich HTML page. This is handled automatically through standard HTTP Accept headers — no special SDK required.",
      },
      {
        question: "Do I need to install anything?",
        answer:
          "No. AgentLair is a fully hosted API platform. You interact with it through REST endpoints. No packages, no SDKs, no infrastructure to manage.",
      },
    ],
  },
  {
    title: "Email & Identity",
    questions: [
      {
        question: "Can my agent send and receive real email?",
        answer:
          "Yes. Each agent gets a real @agentlair.dev email address. Sending and receiving is done through the REST API — no SMTP or IMAP configuration needed.",
      },
      {
        question: "Can I use my own domain?",
        answer:
          "Yes, on the Pro plan and above. You can configure custom domains so your agents have email addresses and profiles on your own domain.",
      },
    ],
  },
  {
    title: "Technical",
    questions: [
      {
        question: "What protocols do you support?",
        answer:
          "AgentLair supports REST API, standard HTTP content negotiation, and is compatible with the emerging agent protocol standards including MCP. Email is handled via REST — we abstract away SMTP/IMAP complexity.",
      },
      {
        question: "Is there a rate limit?",
        answer:
          "Free accounts can send up to 10 emails per day. Pro accounts get 1,000 emails per day. Enterprise accounts have custom limits based on your needs.",
      },
    ],
  },
  {
    title: "Agentic Commerce & Payments",
    questions: [
      {
        question: "How does AgentLair relate to AWS AgentCore Payments?",
        answer:
          "AgentCore Payments handles the wallet. Spend caps, x402 plus Stripe, mid-task burns metered to the cent. AgentLair handles what happens between payments: behavioral attestation, signed by the environment that observed each action and the sequence they came in. Complementary, not competing. AgentCore tells you the agent didn't overspend its budget last week. AgentLair tells you whether the spender is still the spender you authorized when you set that budget.",
      },
      {
        question: "Is AgentLair an alternative to Visa Token Authentication for Payments (TAP)?",
        answer:
          "No. Visa TAP binds an agent to a specific card token at authorization time. That's L1 identity, done well. AgentLair runs at L4: continuous behavioral telemetry that travels with the agent across organizations. You'd use TAP at the card network and AgentLair at the application layer. Different layers, not competing products.",
      },
      {
        question: "What does Mastercard Verifiable Intent miss that AgentLair adds?",
        answer:
          "Verifiable Intent proves the agent had permission at the moment of payment, via SD-JWT delegation chains. It's a snapshot. What it doesn't prove: the agent is still acting within the delegated scope an hour later, or that it hasn't been prompt-injected since. AgentLair runs the continuous side. Observed behavior, baseline drift, real-time anomaly detection. Delegation chains say I gave permission then. AgentLair says the agent is still behaving consistently now.",
      },
    ],
  },
];

export const FAQ = ({
  headerTag = "h2",
  className,
  className2,
}: {
  headerTag?: "h1" | "h2";
  className?: string;
  className2?: string;
}) => {
  return (
    <section id="faq" className={cn("py-28 lg:py-32", className)}>
      <div className="container max-w-5xl">
        <div className={cn("mx-auto grid gap-16 lg:grid-cols-2", className2)}>
          <div className="space-y-4">
            {headerTag === "h1" ? (
              <h1 className="text-2xl tracking-tight md:text-4xl lg:text-5xl">
                Got Questions?
              </h1>
            ) : (
              <h2 className="text-2xl tracking-tight md:text-4xl lg:text-5xl">
                Got Questions?
              </h2>
            )}
            <p className="text-muted-foreground max-w-md leading-snug lg:mx-auto">
              If you can't find what you're looking for,{" "}
              <a
                href="mailto:hello@agentlair.dev"
                className="underline underline-offset-4"
              >
                get in touch
              </a>
              .
            </p>
          </div>

          <div className="grid gap-6 text-start">
            {categories.map((category, categoryIndex) => (
              <div key={category.title} className="">
                <h3 className="text-muted-foreground border-b py-4">
                  {category.title}
                </h3>
                <Accordion type="single" collapsible className="w-full">
                  {category.questions.map((item, i) => (
                    <AccordionItem key={i} value={`${categoryIndex}-${i}`}>
                      <AccordionTrigger>{item.question}</AccordionTrigger>
                      <AccordionContent className="text-muted-foreground">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
