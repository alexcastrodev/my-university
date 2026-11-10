---
title: "Videoconferência escalável com princípios de SDN"
summary: O Scallop refaz a unidade de encaminhamento seletivo por trás das chamadas de vídeo como um programa de switch, de modo que a replicação de pacotes e o descarte de camadas rodam em hardware e um pequeno plano de controle em software cuida do resto.
researchArea: Redes de computadores
keywords: sfu, videoconferência, webrtc, switches programáveis, codificação de vídeo escalável, adaptação de taxa
version: 1.0
updatedAt: 2026-10-31
---

## Visão geral

Serviços como o Google Meet e o Zoom ligam as pessoas de uma chamada por meio de unidades de encaminhamento seletivo (SFUs, de selective forwarding units): servidores que recebem o áudio e o vídeo de cada participante e repassam cópias aos outros, adaptando a qualidade no caminho. Este artigo do SIGCOMM 2025, de Princeton e da Universidade da Virgínia, pergunta se esse trabalho precisa mesmo de um servidor de uso geral.

A pressão vem de como a carga de uma SFU cresce. O número de fluxos de mídia que ela trata cresce com o quadrado dos participantes, porque cada fluxo que chega é copiado para todos os outros participantes. Nos dados de Zoom do campus dos autores, uma reunião de 25 pessoas já gerava mais de 700 fluxos de mídia na SFU. O trabalho fica no caminho crítico da latência, já que cada milissegundo que a SFU acrescenta soma-se ao que os usuários sentem, e a carga é difícil de prever. Os operadores acabam superdimensionando ou escalando automaticamente, correndo o risco de piorar a qualidade das chamadas.

Para ver o efeito de subdimensionar, os autores fixaram a SFU de código aberto Mediasoup em um único núcleo de CPU e foram acrescentando participantes. A taxa de quadros do vídeo começou a cair por volta de 60 participantes, o núcleo chegou a 100% de CPU por volta de 80, e as chamadas ficaram praticamente inutilizáveis a partir de 100 a 120 participantes.

## Contribuição

A ideia central do artigo é que a maior parte do que uma SFU faz com a mídia é o que um switch já faz: replicar um pacote e descartar alguns. Nos traços de Zoom, os servidores enviam cópias exatas dos pacotes RTP que chegam, com apenas endereços e portas reescritos. Quando um fluxo é codificado em camadas (codificação de vídeo escalável), reduzir a resolução ou a taxa de quadros significa descartar os pacotes de uma camada, porque uma camada nunca cruza a fronteira de um pacote.

A partir disso os autores constroem o **Scallop**, uma SFU projetada como uma rede definida por software:

- Um **plano de dados** em um switch programável que replica e encaminha os pacotes de mídia e descarta camadas, com latência abaixo de um milissegundo.
- Um **agente do switch**, um programa na CPU do próprio switch, para tarefas que toleram cerca de 10 ms: ler o retorno dos receptores para escolher a qualidade e responder a verificações de conectividade.
- Um **controlador** central para os eventos raros: uma chamada começar, alguém entrar ou sair, alguém ligar ou desligar o vídeo.

O Scallop é um *proxy verdadeiro*, e não o proxy dividido usual, que termina uma conexão WebRTC por participante. Manter a ilusão de ponto a ponto exige três mecanismos:

- Filtrar o retorno de largura de banda dos receptores, de modo que um emissor seja conduzido pelo seu receptor de melhor desempenho e não pelo mais lento.
- Mapear as reuniões no motor de replicação de pacotes do switch com vários formatos de árvore, movendo uma reunião de um para outro conforme suas necessidades mudam.
- Reescrever os números de sequência do RTP, para que as lacunas deixadas pelas camadas descartadas não sejam lidas pelos receptores como perda de rede.

## Metodologia

O plano de dados é escrito em P4 para um switch Intel Tofino2 (12,8 Tbit/s). O plano de controle é em C++. O protótipo suporta WebRTC com codificação de vídeo escalável em AV1 em três taxas de quadros (7,5, 15 e 30 fps), e o plano de controle escolhe a camada de cada receptor a partir de suas estimativas de banda por meio de uma função substituível.

A avaliação usa uma bancada no campus com clientes rodando no Chrome sem interface, um servidor de 32 núcleos rodando o Mediasoup como base em software, e reproduções de traços de Zoom em escala de campus. Os traços foram anonimizados e revisados pelo processo de ética da universidade.

## Resultados

Estes são os resultados relatados pelos autores, tirados da versão do arXiv de março de 2025.

- Em uma chamada de dez minutos entre três participantes, 96,46% dos pacotes e 99,65% dos bytes foram tratados inteiramente no plano de dados. O restante são retornos, verificações de conectividade e alguns quadros-chave.
- O Scallop suporta de 7 a 210 vezes mais reuniões que o servidor de 32 núcleos, dependendo do formato da reunião. Para reuniões de 10 participantes que enviam áudio e vídeo, com a qualidade adaptada separadamente para cada emissor e receptor, são 4,3 mil reuniões contra 192. Sem adaptação de taxa, até 128 mil reuniões simultâneas.
- As reuniões de dois participantes são 60% das reuniões nos dados do campus e, como não precisam de replicação, são o caso mais barato: 533 mil reuniões contra 4,8 mil do servidor.
- A latência que uma SFU acrescenta cai por um fator de cerca de 26.
- Com adaptação de taxa, um participante com banda limitada cai de 30 para 15 fps sem travamentos. As heurísticas de números de sequência custam algumas retransmissões, que segundo os autores ficam abaixo de 20% mesmo com taxas de perda muito altas.

## Análise crítica

A ideia está bem sustentada como argumento de sistemas, e o protótipo roda em hardware real, mas ainda é inicial.

- **Sem criptografia.** A mídia do WebRTC é criptografada por conexão, e o Scallop não implementa isso nem as verificações de integridade. Um proxy que copia os pacotes de um emissor para muitos receptores precisa, em vez disso, de uma distribuição de chaves de um para muitos, que os autores discutem mas não constroem. Os números de capacidade não incluem esse custo.
- **Suporte restrito a codecs.** O protótipo depende do vídeo em camadas do AV1 com seus descritores de dependência. Chamadas que usam outros codecs, ou simulcast (várias codificações separadas), ficam fora do que foi medido.
- **Heurísticas que podem errar.** A reescrita de números de sequência não pode ser exata com perda e reordenação. O projeto prefere deixar lacunas extras, que custam retransmissões, a arriscar duplicar um número, o que trava o decodificador até chegar um novo quadro-chave.
- **Uma comparação de capacidade, não de custo.** A afirmação é de mais reuniões por equipamento contra uma SFU em software de 32 núcleos. Preço, energia e operação de um switch programável não são medidos.
- **Uma só SFU.** Encadear várias SFUs entre sites é descrito como meta de projeto, mas não é implementado, e funções que precisam da mídia em si, como gravação ou transcodificação, não podem rodar nesse plano de dados.
- **O Zoom é inferido.** O que os autores dizem sobre os servidores do Zoom vem de traços de pacotes. Eles afirmam que não conhecem a arquitetura por trás deles.

O texto lido aqui é o preprint, então detalhes da versão dos anais podem diferir.

## Pesquisas futuras

- Distribuição de chaves de um para muitos e criptografia no plano de dados ou em uma placa de rede inteligente.
- Vários switches ou sites formando uma só chamada, com o controlador coordenando-os.
- Outros codecs e simulcast, e políticas de escolha de camada melhores que a simples, por limiar, que os autores implementaram.
- Como combinar um caminho de encaminhamento em hardware com um software que precisa olhar dentro da mídia.
- Se a mesma divisão serve à outra metade do problema, como a recuperação de perdas entre saltos (o artigo do Tambur em Papers trata da recuperação de perdas em chamadas entre duas pessoas).
