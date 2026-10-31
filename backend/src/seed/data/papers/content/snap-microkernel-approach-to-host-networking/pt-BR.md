---
title: "Snap: a Microkernel Approach to Host Networking"
summary: O Google tira a rede do host do kernel e a leva para um sistema em espaço de usuário de engines modulares, com atualizações transparentes e um escalonador projetado junto com o kernel.
version: 1.0
updatedAt: 2026-10-31
---

## Visão geral

O Snap é o sistema de rede de host que o Google construiu para substituir boa parte da pilha de rede do kernel em suas máquinas. Este artigo do SOSP 2019 apresenta seu projeto e a experiência de operá-lo em produção por mais de três anos.

O problema é que grandes provedores precisam acrescentar funções de rede rapidamente (virtualização, modelagem de tráfego, comutação de pacotes, um transporte rápido) mantendo o desempenho alto, e mudar uma pilha de kernel numa frota inteira é lento e arriscado.

## Contribuição

As contribuições do artigo são uma arquitetura e as lições operacionais dela.

- Um projeto **inspirado em microkernel**: a rede roda num processo em espaço de usuário feito de módulos desenvolvidos de forma independente, chamados engines, em vez de rodar no kernel.
- Um serviço de transporte e mensagens chamado Pony Express, com uma interface parecida com RDMA.
- Atualizações transparentes do serviço de rede sem tirar as aplicações de uma máquina.
- Um projeto de escalonamento de CPU dividido entre o kernel e o espaço de usuário, que suporta comportamento de tempo real com escala dinâmica dos recursos de CPU.

## Metodologia

Os engines do Snap são módulos de processamento de pacotes de propósito único, construídos com sincronização criteriosa e o mínimo de estado compartilhado. Como vivem em espaço de usuário, ganham isolamento de espaço de endereçamento e a produtividade do desenvolvimento de software comum, e podem ser lançados com muito mais frequência que código de kernel.

O artigo descreve o modelo de engines, as interfaces de controle, como uma atualização inicia uma nova instância de cada engine enquanto a antiga ainda roda e depois move seu estado durante um curto blackout, e os modos de escalonamento dos núcleos de CPU que os engines usam (núcleos dedicados, espalhamento de engines e compactação de engines). Avalia o sistema com cargas de RPC, uma carga de software tipo RDMA e medições de atualização.

## Resultados

Estes são os resultados relatados pelos autores.

- Mais de 3x de melhora em Gbps por núcleo em comparação com uma pilha de rede de kernel para cargas de RPC.
- Desempenho de software tipo RDMA de até 5 milhões de IOPS por núcleo.
- Atualizações transparentes que os autores descrevem como em grande parte imperceptíveis para as aplicações.
- O Snap está em produção há mais de três anos e implantado em mais da metade da frota de máquinas do Google.

## Análise crítica

É um artigo de experiência de um operador muito grande, e seu valor está nas lições práticas, não numa comparação controlada.

Pontos para ler com cuidado:

- A linha de base é uma pilha de kernel ajustada para uso geral, e o ganho de destaque vale para uma carga específica de RPC. O benefício para outros tipos de tráfego pode ser diferente.
- Alguns modos de escalonamento prendem engines a hyperthreads dedicados, o que troca CPU por latência, então os números de eficiência dependem do modo escolhido.
- O cenário é uma frota em que um único operador controla os hosts, a rede e as aplicações, o que está longe de uma implantação típica, e o sistema é interno ao Google, então os resultados não podem ser reproduzidos fora dele.

## Pesquisas futuras

- Quanto da abordagem se aplica a operadores sem o controle que o Google tem de hardware e software.
- Isolamento e segurança entre engines e aplicações num processo compartilhado em espaço de usuário.
- Combinar rede em espaço de usuário com recursos mais novos do kernel para E/S rápida.
- Escalonamento para engines que misture garantias de nível de kernel com política em espaço de usuário (um tema que o artigo do ghOSt leva adiante).
