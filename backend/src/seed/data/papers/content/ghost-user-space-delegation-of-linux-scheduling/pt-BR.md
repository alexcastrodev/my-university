---
title: "ghOSt: Fast & Flexible User-Space Delegation of Linux Scheduling"
summary: Uma forma de rodar a política de escalonamento do Linux em agentes em espaço de usuário enquanto o kernel só executa as decisões, de modo que as políticas mudem sem reiniciar o host.
version: 1.0
updatedAt: 2026-10-31
---

## Visão geral

Onde as threads rodam, e por quanto tempo, afeta muito a vazão, a latência de cauda e a segurança de cargas de data centers. Mesmo assim, escalonadores de kernel são difíceis de mudar: são difíceis de implementar, testar e distribuir numa frota grande.

Este artigo do SOSP 2021, do Google, apresenta o ghOSt, uma infraestrutura que delega as decisões de escalonamento do kernel a código que roda em espaço de usuário no Linux.

## Contribuição

A contribuição do ghOSt é um mecanismo de delegação de propósito geral, não uma nova política de escalonamento.

- As políticas vivem em agentes em espaço de usuário, escritos em qualquer linguagem e atualizados sem reiniciar o host.
- O kernel fornece **encapsulamento de estado** (o que o agente precisa saber), mecanismos de **comunicação** e de **ação**, e ajuda na sincronização entre o kernel e o agente.
- Suporta uma ampla gama de modelos, de por CPU a centralizado e de execução até o fim a preemptivo.
- A intenção é tornar práticas as políticas de escalonamento sob medida que pesquisas recentes construíram dentro de sistemas operacionais de plano de dados personalizados, difíceis de implantar por aplicação num ambiente multi-inquilino.

## Metodologia

O projeto acrescenta ao kernel do Linux uma classe de escalonamento ghOSt. As threads gerenciadas pelo ghOSt são escalonadas conforme decisões que agentes em espaço de usuário devolvem, e os agentes recebem do kernel o estado de que precisam. O repositório público descreve as decisões sendo executadas como transações e inclui políticas de exemplo, como FIFO centralizado e por CPU, uma política parecida com o CFS e uma no estilo Shinjuku.

Os autores avaliam o ghOSt em cargas acadêmicas e em cargas reais, incluindo o Google Snap e o Google Search, comparando-o com o escalonador do kernel.

## Resultados

Estes são os resultados relatados pelos autores, como declarado no resumo.

- Usando o ghOSt no lugar do escalonador do kernel, os autores chegam rapidamente a vazão e latência comparáveis.
- Além disso, ele permite otimização de políticas, atualizações sem interrupção e isolamento de falhas para as cargas dos seus data centers.
- O ghOSt tem baixo custo para as ações de escalonamento nos modelos de escalonamento suportados.
- A implementação é de código aberto.

Esta análise se baseia no resumo e na documentação pública do projeto. Para números de cargas específicas, consulte o artigo.

## Análise crítica

A ideia responde a um problema real de implantação, e a liberação em código aberto permite experimentá-la.

Pontos para ler com cuidado:

- "Comparável" é a manchete: a proposta é flexibilidade e operabilidade mais do que velocidade, então o valor depende de quanto uma política sob medida rende para a sua carga.
- Tirar as decisões do kernel acrescenta uma etapa de comunicação entre o kernel e o agente. Veja no artigo quanto os modelos centralizado e por CPU custam em CPU e latência.
- O resumo promete isolamento de falhas. Veja no artigo o que acontece com as threads quando um agente trava ou fica para trás.
- Exige um kernel Linux modificado, o que limita a adoção fora de operadores que mantêm seus próprios kernels.

## Pesquisas futuras

- Levar a interface de delegação para o Linux principal, ou um equivalente que não exija um fork.
- Políticas que usem melhor o conhecimento da aplicação, como tipos de requisição ou prazos, e como expressá-las com segurança.
- Verificar políticas em espaço de usuário, já que uma política ruim pode deixar threads sem execução.
- Combinar escalonamento delegado com outros sistemas de caminho de dados em espaço de usuário (veja Snap e Demikernel).
