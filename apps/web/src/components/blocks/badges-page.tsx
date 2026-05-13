"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BadgeBuilder } from "@/components/blocks/badge-builder";
import { A2ABadgeBuilder } from "@/components/blocks/a2a-badge-builder";

export const BadgesPage = () => {
  return (
    <div className="pt-8 px-4 max-w-4xl mx-auto">
      <Tabs defaultValue="agentlair">
        <div className="flex justify-center mb-2">
          <TabsList>
            <TabsTrigger value="agentlair">AgentLair Trust</TabsTrigger>
            <TabsTrigger value="a2a">A2A Card Audit</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="agentlair">
          <BadgeBuilder />
        </TabsContent>
        <TabsContent value="a2a">
          <A2ABadgeBuilder />
        </TabsContent>
      </Tabs>
    </div>
  );
};
